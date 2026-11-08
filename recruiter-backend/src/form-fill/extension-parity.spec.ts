import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { serializePlan } from './native-chrome.service';
import {
  APPLICATION_ACTION_LABEL,
  GOOGLE_LOGIN_LABEL,
} from './application-navigation';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
async function setup(html: string) {
  const page = await browser.newPage();
  await page.setContent(html);
  for (const file of ['fill.js', 'navigation.js']) {
    const code = await readFile(
      join(process.cwd(), '..', 'chrome-extension', file),
      'utf8',
    );
    await page.addScriptTag({ content: code.replace('export ', '') });
  }
  return page;
}
async function fill(page: Page, plan: unknown) {
  return page.evaluate(
    (p) =>
      (
        window as unknown as {
          fillCurrentDocument: (
            p: unknown,
          ) => Promise<{ filled: string[]; skipped: string[] }>;
        }
      ).fillCurrentDocument(p),
    plan,
  );
}
const attachment = {
  fileName: 'curriculo.pdf',
  base64: Buffer.from('%PDF-1.7 fixture').toString('base64'),
};
it('fills all configured personal details, professional links, salary and summary', async () => {
  const labels = [
    'Nome completo',
    'E-mail',
    'Telefone',
    'Cidade',
    'LinkedIn',
    'GitHub',
    'Portfólio',
    'Vídeo de apresentação',
    'Pretensão salarial',
    'Resumo profissional',
  ];
  const page = await setup(
    '<form onsubmit="window.sent=true;return false">' +
      labels
        .map((label, i) => `<label>${label}<input id="f${i}"></label>`)
        .join('') +
      '<button>Enviar</button></form>',
  );
  const values = [
    'Pessoa Teste',
    'test@example.com',
    '34999990000',
    'Uberlândia, MG',
    'https://linkedin.com/in/test',
    'https://github.com/test',
    'https://example.com',
    'https://example.com/video',
    'R$ 5.000',
    'Experiência em suporte técnico',
  ];
  try {
    const fields = serializePlan(
      buildFieldPlan({
        name: values[0],
        email: values[1],
        phone: values[2],
        location: values[3],
        links: {
          linkedin: values[4],
          github: values[5],
          website: values[6],
          presentationVideo: values[7],
        },
        resume: null,
        defaults: {
          fullName: values[0],
          salaryExpectation: values[8],
          experienceSummary: values[9],
        },
      }),
    );
    await fill(page, { fields, blocked: NEVER_FILL.source });
    for (let i = 0; i < values.length; i++)
      expect(await page.locator(`#f${i}`).inputValue()).toBe(values[i]);
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await page.close();
  }
});
it('chooses Google sign-in ahead of password/name/email controls and never enters credentials', async () => {
  const page = await setup(
    '<form><label>Nome completo<input name="name"></label><label>Email<input type="email"></label><input type="password"><button type="button" aria-label="Entrar com o Google" onclick="window.loginOpened=true">Entrar com o Google</button></form>',
  );
  try {
    const inspect = (key: string | null = null) =>
      page.evaluate(
        ({ key, apply, google }) =>
          (
            window as unknown as {
              inspectApplicationDocument: (
                n: unknown,
                k: string | null,
              ) => { kind: string; key: string };
            }
          ).inspectApplicationDocument({ apply, google }, key),
        {
          key,
          apply: APPLICATION_ACTION_LABEL.source,
          google: GOOGLE_LOGIN_LABEL.source,
        },
      );
    const action = await inspect();
    expect(action.kind).toBe('navigate');
    expect((await inspect(action.key)).kind).toBe('clicked');
    expect(
      await page.evaluate(() => Object.hasOwn(window, 'loginOpened')),
    ).toBe(true);
    expect(await page.locator('input[type=password]').inputValue()).toBe('');
  } finally {
    await page.close();
  }
});
it('captures a resume button that creates an unnamed input lazily and restores native methods', async () => {
  const page = await setup(
    "<a href=\"#\" onclick=\"event.preventDefault(); setTimeout(() => {const input=document.createElement('input');input.type='file';input.id='upload';document.body.append(input);input.click()}, 100)\">Carregar currículo</a>",
  );
  try {
    await page.evaluate(() => {
      (window as unknown as { oldClick: unknown }).oldClick = Reflect.get(
        HTMLInputElement.prototype,
        'click',
      );
    });
    let chooser = false;
    page.on('filechooser', () => {
      chooser = true;
    });
    expect(
      (await fill(page, { fields: [], blocked: NEVER_FILL.source, attachment }))
        .filled,
    ).toContain('currículo PDF');
    expect(
      await page
        .locator('#upload')
        .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
    ).toBe('curriculo.pdf');
    expect(chooser).toBe(false);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { oldClick: unknown }).oldClick ===
          HTMLInputElement.prototype.click,
      ),
    ).toBe(true);
  } finally {
    await page.close();
  }
});
it('does not confuse a cover letter with a resume, overwrite attachments or choose ambiguous inputs', async () => {
  const page = await setup(
    '<input type="file" id="resume_cover_letter"><input type="file" id="resume">',
  );
  try {
    await fill(page, { fields: [], blocked: NEVER_FILL.source, attachment });
    expect(
      await page
        .locator('#resume_cover_letter')
        .evaluate((e: HTMLInputElement) => e.files?.length),
    ).toBe(0);
    await fill(page, {
      fields: [],
      blocked: NEVER_FILL.source,
      attachment: { ...attachment, fileName: 'outro.pdf' },
    });
    expect(
      await page
        .locator('#resume')
        .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
    ).toBe('curriculo.pdf');
    await page.evaluate(() => {
      document.querySelector('#resume')!.remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<input type="file" id="resume1"><input type="file" id="resume2">',
      );
    });
    expect(
      (await fill(page, { fields: [], blocked: NEVER_FILL.source, attachment }))
        .skipped,
    ).toContain('currículo PDF');
    expect(
      await page
        .locator('#resume1')
        .evaluate((e: HTMLInputElement) => e.files?.length),
    ).toBe(0);
  } finally {
    await page.close();
  }
});
