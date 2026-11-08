import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { serializePlan } from './native-chrome.service';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { emptyFormFillDefaults, formFillDefaultsSchema } from '@recruit/shared';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
it.each(['Último salário', 'Salário anterior', 'Previous salary'])(
  'keeps %s separate from salary expectations and current salary',
  async (label) => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<form onsubmit="window.sent=true;return false"><label>${label}<input id="past"></label><label>Pretensão salarial<input id="expected"></label><label>Salário atual<input id="current"></label><button>Enviar</button></form>`,
      );
      await page.addScriptTag({
        content: (
          await readFile(
            join(process.cwd(), '..', 'chrome-extension/fill.js'),
            'utf8',
          )
        ).replace('export ', ''),
      });
      const defaults = formFillDefaultsSchema.parse({
        ...emptyFormFillDefaults,
        lastSalary: 'R$ 4.000 mensais',
        salaryExpectation: 'R$ 5.000 mensais',
      });
      const source = {
        name: 'Pessoa',
        email: null,
        phone: null,
        location: null,
        links: null,
        resume: null,
      };
      const fields = serializePlan(buildFieldPlan({ ...source, defaults }));
      const run = (fields: unknown) =>
        page.evaluate(
          (plan) =>
            (
              window as unknown as {
                fillCurrentDocument: (p: unknown) => Promise<unknown>;
              }
            ).fillCurrentDocument(plan),
          { fields, blocked: NEVER_FILL.source },
        );
      await run(fields);
      expect(await page.locator('#past').inputValue()).toBe('R$ 4.000 mensais');
      expect(await page.locator('#expected').inputValue()).toBe(
        'R$ 5.000 mensais',
      );
      expect(await page.locator('#current').inputValue()).toBe('');
      expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
        false,
      );
      await page.locator('#past').fill('');
      await run(
        serializePlan(
          buildFieldPlan({
            ...source,
            defaults: { ...defaults, lastSalary: null },
          }),
        ),
      );
      expect(await page.locator('#past').inputValue()).toBe('');
    } finally {
      await page.close();
    }
  },
);
it('fills recognized empty fields and the PDF while preserving existing values and never submitting', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<form onsubmit="window.submitted=true;return false"><label>Nome completo<input id="name"></label><label>E-mail<input id="email" value="existing@example.com"></label><label>Por que deseja trabalhar aqui?<textarea id="why"></textarea></label><label>Pretensão salarial<input id="salary"></label><label>Currículo<input name="resume" type="file"></label><button>Enviar</button></form>',
    );
    const code = await readFile(
      join(process.cwd(), '..', 'chrome-extension', 'fill.js'),
      'utf8',
    );
    await page.addScriptTag({
      content: code.replace('export ', ''),
    });
    const fields = serializePlan(
      buildFieldPlan({
        name: 'Carlos Silva de Souza',
        email: 'new@example.com',
        phone: null,
        location: null,
        links: null,
        resume: null,
        defaults: {
          fullName: 'Carlos Silva de Souza',
          salaryExpectation: 'R$ 5.000',
          experienceSummary: 'Suporte de TI',
        },
      }),
    );
    const report: unknown = await page.evaluate(
      (plan) => {
        const fn = (
          window as unknown as { fillCurrentDocument: (p: unknown) => unknown }
        ).fillCurrentDocument;
        return fn(plan);
      },
      {
        fields,
        blocked: NEVER_FILL.source,
        attachment: {
          fileName: 'curriculo.pdf',
          base64: Buffer.from('%PDF-1.7 test').toString('base64'),
        },
      },
    );
    expect(await page.locator('#name').inputValue()).toBe(
      'Carlos Silva de Souza',
    );
    expect(await page.locator('#email').inputValue()).toBe(
      'existing@example.com',
    );
    expect(await page.locator('#why').inputValue()).toBe('');
    expect(await page.locator('#salary').inputValue()).toBe('R$ 5.000');
    expect(
      await page
        .locator('input[type=file]')
        .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
    ).toBe('curriculo.pdf');
    expect(report).toMatchObject({ submitted: false });
    expect(await page.evaluate(() => Object.hasOwn(window, 'submitted'))).toBe(
      false,
    );
  } finally {
    await page.close();
  }
});
