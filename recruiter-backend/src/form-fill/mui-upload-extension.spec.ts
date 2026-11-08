import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { serializePlan } from './native-chrome.service';
import { emptyFormFillDefaults } from '@recruit/shared';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
const cpf =
  '<div class="MuiFormControl-root" id="textfield-ds-52-form-control"><label id="textfield-ds-52-label" for="textfield-ds-52">CPF</label><div data-testid="cpf-input"><input aria-invalid="false" id="textfield-ds-52" type="text" aria-labelledby="textfield-ds-52-label" value=""></div></div>';
const upload = (kind: string, id: string) =>
  `<section><button type="button"><div><svg aria-hidden="true"></svg><p>Adicionar arquivo</p></div><p>O arquivo do ${kind} deve estar nos formatos: DOCX ou PDF</p></button><input type="file" accept=".docx,.pdf" id="${id}" hidden></section>`;
async function fillIsolated(
  page: Page,
  withCpf = true,
  fileName = 'curriculo.pdf',
) {
  const fields = serializePlan(
    buildFieldPlan({
      name: 'Pessoa',
      email: null,
      phone: null,
      location: null,
      links: null,
      resume: null,
      defaults: {
        ...emptyFormFillDefaults,
        cpf: withCpf ? '52998224725' : null,
      },
    }),
  );
  const plan = {
    fields,
    blocked: NEVER_FILL.source,
    attachment: {
      fileName,
      base64: Buffer.from('%PDF-1.7 fixture').toString('base64'),
    },
  };
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Page.getFrameTree');
  const world = await session.send('Page.createIsolatedWorld', {
    frameId: tree.frameTree.frame.id,
    worldName: 'job-tracker-mui-test',
  });
  const code = (
    await readFile(
      join(process.cwd(), '..', 'chrome-extension/fill.js'),
      'utf8',
    )
  ).replace('export ', '');
  const result = await session.send('Runtime.evaluate', {
    contextId: world.executionContextId,
    expression: code + ';fillCurrentDocument(' + JSON.stringify(plan) + ')',
    awaitPromise: true,
    returnByValue: true,
  });
  expect(result.exceptionDetails).toBeUndefined();
  const report: unknown = result.result.value;
  await session.detach();
  return report as {
    filled: string[];
    skipped: string[];
    needsReview: string[];
  };
}
it('recognizes the pasted resume button and attaches the PDF to its mounted input in an isolated world', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      cpf +
        upload('currículo', 'upload-52') +
        upload('certificado', 'upload-53') +
        '<button onclick="window.sent=true">Enviar</button>',
    );
    let chooser = false;
    page.on('filechooser', () => {
      chooser = true;
    });
    await page.addScriptTag({
      content: (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension/navigation.js'),
          'utf8',
        )
      ).replace('export ', ''),
    });
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              inspectApplicationDocument: (p: unknown) => { kind: string };
            }
          ).inspectApplicationDocument({ apply: 'apply' }).kind,
      ),
    ).toBe('form');
    const report = await fillIsolated(page);
    expect(report.filled).toEqual(
      expect.arrayContaining(['CPF', 'currículo PDF']),
    );
    expect(await page.locator('#textfield-ds-52').inputValue()).toBe(
      '52998224725',
    );
    expect(
      await page
        .locator('#upload-52')
        .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
    ).toBe('curriculo.pdf');
    expect(
      await page
        .locator('#upload-53')
        .evaluate((e: HTMLInputElement) => e.files?.length),
    ).toBe(0);
    expect(chooser).toBe(false);
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
    await fillIsolated(page, true, 'outro.pdf');
    expect(
      await page
        .locator('#upload-52')
        .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
    ).toBe('curriculo.pdf');
  } finally {
    await page.close();
  }
});
it('leaves CPF for review when it was not saved, without confusing a certificate upload with a resume', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(cpf + upload('certificado', 'upload-52'));
    const report = await fillIsolated(page, false);
    expect(await page.locator('#textfield-ds-52').inputValue()).toBe('');
    expect(report.needsReview).toContain('CPF');
    expect(report.skipped).toContain('currículo PDF');
    expect(
      await page
        .locator('#upload-52')
        .evaluate((e: HTMLInputElement) => e.files?.length),
    ).toBe(0);
  } finally {
    await page.close();
  }
});
