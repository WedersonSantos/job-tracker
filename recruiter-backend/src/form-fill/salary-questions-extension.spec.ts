import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { serializePlan } from './native-chrome.service';
import { locateField } from './field-locator';
import { emptyFormFillDefaults } from '@recruit/shared';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
it('fills the exact combined last/current question and expectation in an isolated world without selecting a duplicate heading', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://grupoboticario.gupy.io/**', (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<textarea id="last" name="Qual a sua última / atual remuneração?" aria-required="true"></textarea><textarea id="expected" name="Qual a sua expectativa salarial?" aria-required="true"></textarea><div><h3>3. Qual a sua expectativa salarial? *</h3><div class="form-group"><textarea id="unrelated" name="opaque-duplicate"></textarea></div></div><textarea id="current" name="Qual a sua remuneração atual?"></textarea><button onclick="window.sent=true">Finalizar candidatura</button>',
      }),
    );
    await page.goto(
      'https://grupoboticario.gupy.io/candidates/applications/test/steps/test/curriculum',
    );
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
          lastSalary: '3500',
          salaryExpectation: '5000',
        },
      }),
    );
    const session = await page.context().newCDPSession(page);
    const tree = await session.send('Page.getFrameTree');
    const world = await session.send('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'salary-gupy-regression',
    });
    const code = (
      await readFile(
        join(process.cwd(), '..', 'chrome-extension/fill.js'),
        'utf8',
      )
    ).replace('export ', '');
    const result = await session.send('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression:
        code +
        ';fillCurrentDocument(' +
        JSON.stringify({ fields, blocked: NEVER_FILL.source }) +
        ')',
      awaitPromise: true,
      returnByValue: true,
    });
    expect(result.exceptionDetails).toBeUndefined();
    expect(await page.locator('#last').inputValue()).toBe('3500');
    expect(await page.locator('#expected').inputValue()).toBe('5000');
    expect(await page.locator('#unrelated').inputValue()).toBe('');
    expect(await page.locator('#current').inputValue()).toBe('');
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await page.close();
  }
});
it.each([true, false])(
  'matches numbered Gupy salary questions through their names or h3 headings (names=%s)',
  async (questionNames) => {
    const page = await browser.newPage();
    try {
      await page.route('https://grupoboticario.gupy.io/**', (r) =>
        r.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<div><h3>2. Qual foi a sua última remuneração?<strong> *</strong></h3><div class="form-group textarea"><div><textarea id="past" name="${questionNames ? 'Qual foi a sua última remuneração?' : 'opaque-past'}" aria-required="true" placeholder="Digite sua resposta aqui"></textarea></div></div></div><div><h3>3. Qual a sua expectativa salarial?<strong> &nbsp;*</strong></h3><div class="form-group textarea"><div><textarea id="expected" name="${questionNames ? 'Qual a sua expectativa salarial?' : 'opaque-expected'}" aria-required="true" placeholder="Digite sua resposta aqui" maxlength="1000"></textarea></div></div></div><label>Salário atual<input id="current"></label><button onclick="window.sent=true">Finalizar candidatura</button>`,
        }),
      );
      await page.goto(
        'https://grupoboticario.gupy.io/candidates/applications/test/steps/test/curriculum',
      );
      await page.addScriptTag({
        content: (
          await readFile(
            join(process.cwd(), '..', 'chrome-extension/fill.js'),
            'utf8',
          )
        ).replace('export ', ''),
      });
      const source = {
        name: 'Pessoa',
        email: null,
        phone: null,
        location: null,
        links: null,
        resume: null,
        defaults: {
          ...emptyFormFillDefaults,
          lastSalary: '3500',
          salaryExpectation: '5000',
        },
      };
      const plan = buildFieldPlan(source);
      if (questionNames) {
        expect(
          await locateField(
            page,
            plan.find((f) => f.what === 'último salário')!,
          ),
        ).not.toBeNull();
        expect(
          await locateField(
            page,
            plan.find((f) => f.what === 'pretensão salarial')!,
          ),
        ).not.toBeNull();
      }
      const fields = serializePlan(plan);
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
      expect(await page.locator('#past').inputValue()).toBe('3500');
      expect(await page.locator('#expected').inputValue()).toBe('5000');
      expect(await page.locator('#current').inputValue()).toBe('');
      await page.locator('#expected').fill('4200');
      await page.locator('#past').fill('');
      await run(
        serializePlan(
          buildFieldPlan({
            ...source,
            defaults: { ...source.defaults, lastSalary: null },
          }),
        ),
      );
      expect(await page.locator('#past').inputValue()).toBe('');
      expect(await page.locator('#expected').inputValue()).toBe('4200');
      expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
        false,
      );
    } finally {
      await page.close();
    }
  },
);
