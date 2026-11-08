import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { serializePlan } from './native-chrome.service';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
jest.setTimeout(15000);
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
const entry =
  '<div class="ashby-application-form-field-entry" data-field-path="_systemfield_location"><label class="_required_abc" for="_systemfield_location">Location</label><div><input role="combobox" placeholder="Start typing..."></div></div>';
async function setup(html: string, options: string[] = [], delay = 100) {
  const page = await browser.newPage();
  await page.route('https://jobs.ashbyhq.com/**', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(
    'https://jobs.ashbyhq.com/lemon-io/4dc7dd66-686c-4a07-82cc-a1a8448d34c6/application',
  );
  for (const file of ['navigation.js', 'fill.js'])
    await page.addScriptTag({
      content: (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension', file),
          'utf8',
        )
      ).replace('export ', ''),
    });
  await page.evaluate(
    ({ options, delay }) => {
      const input =
        document.querySelector<HTMLInputElement>('[role=combobox]')!;
      input.addEventListener('input', () => {
        if (!input.value) return;
        setTimeout(() => {
          document.querySelector('[role=listbox]')?.remove();
          const list = document.createElement('div');
          list.role = 'listbox';
          for (const text of options) {
            const option = document.createElement('div');
            option.role = 'option';
            option.textContent = text;
            option.onclick = () => {
              input.value = text;
              (window as unknown as { selected: boolean }).selected = true;
              list.remove();
            };
            list.append(option);
          }
          document.body.append(list);
        }, delay);
      });
    },
    { options, delay },
  );
  return page;
}
async function inspect(page: Page, phase = 'discover') {
  return page.evaluate(
    (phase) =>
      (
        window as unknown as {
          inspectApplicationDocument: (
            n: unknown,
            k: null,
            p: string,
          ) => { kind: string; missing?: string[] };
        }
      ).inspectApplicationDocument({ apply: '^Apply$' }, null, phase),
    phase,
  );
}
it.each([
  'Uberlândia, MG, Brasil',
  'Uberlândia, State of Minas Gerais, Brazil',
])(
  'selects delayed localized results from the same isolated execution world as the extension: %s',
  async (option) => {
    const page = await setup(entry, [option], 3000);
    try {
      const session = await page.context().newCDPSession(page);
      const tree = await session.send('Page.getFrameTree');
      const isolated = await session.send('Page.createIsolatedWorld', {
        frameId: tree.frameTree.frame.id,
        worldName: 'job-tracker-regression',
      });
      const source = (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension/fill.js'),
          'utf8',
        )
      ).replace('export ', '');
      const fields = serializePlan(
        buildFieldPlan({
          name: 'Pessoa',
          email: null,
          phone: null,
          location: 'Uberlândia, Minas Gerais',
          links: null,
          resume: null,
        }),
      );
      const result = await session.send('Runtime.evaluate', {
        contextId: isolated.executionContextId,
        expression:
          source +
          ';fillCurrentDocument(' +
          JSON.stringify({ fields, blocked: NEVER_FILL.source }) +
          ')',
        awaitPromise: true,
        returnByValue: true,
      });
      expect(result.exceptionDetails).toBeUndefined();
      const report: unknown = result.result.value;
      expect((report as { filled: string[] }).filled).toContain('localização');
      expect(await page.locator('[role=combobox]').inputValue()).toBe(option);
      expect(await page.evaluate(() => Object.hasOwn(window, 'selected'))).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  },
);
it('recognizes the actual Ashby structure without a form tag and fills only configured facts', async () => {
  const page = await setup(
    `<div class="ashby-application-form-field-entry"><label for="_systemfield_name">Name</label><input id="_systemfield_name" name="_systemfield_name" required><label for="_systemfield_email">Email</label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>${entry}<input type="file"><label>Resume<input type="file" id="_systemfield_resume" required></label><label>Your LinkedIn profile<input id="linkedin" type="url"></label><label>In the product you're currently working on, what was the last user problem you solved?<textarea id="problem"></textarea></label><label>What metric did you manage to improve, and how?<textarea id="metric"></textarea></label><label>Your compensation expectations<input id="compensation"></label><button onclick="window.sent=true">Submit Application</button>`,
    [
      'Uberlândia, Minas Gerais, Brazil',
      'Mga, Kirovsky District, Leningrad, Russia',
    ],
  );
  try {
    expect((await inspect(page)).kind).toBe('form');
    const fields = serializePlan(
      buildFieldPlan({
        name: 'Pessoa Teste',
        email: 'test@example.com',
        phone: null,
        location: 'Uberlândia, MG',
        links: { linkedin: 'https://linkedin.com/in/test' },
        resume: null,
        defaults: { salaryExpectation: 'R$ 5.000' },
      }),
    );
    const report = await page.evaluate(
      (plan) =>
        (
          window as unknown as {
            fillCurrentDocument: (p: unknown) => Promise<{ filled: string[] }>;
          }
        ).fillCurrentDocument(plan),
      {
        fields,
        blocked: NEVER_FILL.source,
        attachment: {
          fileName: 'resume.pdf',
          base64: Buffer.from('%PDF test').toString('base64'),
        },
      },
    );
    expect(report.filled).toEqual(
      expect.arrayContaining([
        'nome completo',
        'email',
        'localização',
        'LinkedIn',
        'pretensão salarial',
        'currículo PDF',
      ]),
    );
    expect(await page.locator('[role=combobox]').inputValue()).toBe(
      'Uberlândia, Minas Gerais, Brazil',
    );
    expect(await page.locator('#compensation').inputValue()).toBe('R$ 5.000');
    expect(await page.locator('#problem').inputValue()).toBe('');
    expect(await page.locator('#metric').inputValue()).toBe('');
    expect(
      await page
        .locator('input[type=file]')
        .first()
        .evaluate((e: HTMLInputElement) => e.files?.length),
    ).toBe(0);
    expect((await inspect(page, 'progress')).kind).toBe('final');
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await page.close();
  }
});
it('recognizes a later section with only location and reports its unlinked required label', async () => {
  const page = await setup(entry + '<button>Submit Application</button>');
  try {
    expect((await inspect(page)).kind).toBe('form');
    expect((await inspect(page, 'progress')).missing).toContain('Location');
  } finally {
    await page.close();
  }
});
it.each([
  ['Uberlândia, MG', ['Uberlândia, São Paulo, Brazil']],
  [
    'Springfield',
    [
      'Springfield, Illinois, United States',
      'Springfield, Massachusetts, United States',
    ],
  ],
])(
  'does not select an incorrect or ambiguous location: %s',
  async (location, options) => {
    const page = await setup(entry, options);
    try {
      const fields = serializePlan(
        buildFieldPlan({
          name: 'Pessoa',
          email: null,
          phone: null,
          location: location,
          links: null,
          resume: null,
        }),
      );
      await page.evaluate(
        (plan) =>
          (
            window as unknown as {
              fillCurrentDocument: (p: unknown) => Promise<unknown>;
            }
          ).fillCurrentDocument(plan),
        { fields, blocked: NEVER_FILL.source },
      );
      expect(await page.locator('[role=combobox]').inputValue()).toBe('');
      expect((await inspect(page, 'progress')).kind).toBe('review');
      expect(await page.evaluate(() => Object.hasOwn(window, 'selected'))).toBe(
        false,
      );
    } finally {
      await page.close();
    }
  },
);
