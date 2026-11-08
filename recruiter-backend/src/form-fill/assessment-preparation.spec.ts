import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
async function setup(
  html: string,
  url = 'https://assessments.gupy.io/behavioral/sample',
) {
  const page = await browser.newPage();
  await page.route('https://**/*', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(url);
  const source = await readFile(
    join(process.cwd(), '..', 'chrome-extension/navigation.js'),
    'utf8',
  );
  await page.addScriptTag({ content: source.replace('export ', '') });
  const inspect = (key: string | null = null) =>
    page.evaluate(
      (key) =>
        (
          window as unknown as {
            inspectApplicationDocument: (
              navigation: unknown,
              key: string | null,
              phase: string,
            ) => unknown;
          }
        ).inspectApplicationDocument(
          { apply: '^Apply now$' },
          key,
          'assessment',
        ),
      key,
    ) as Promise<{
      kind: string;
      key: string;
      stage?: string;
      reason?: string;
      ranking?: {
        items: { statement: string; rank: number | null }[];
        complete: boolean;
        duplicate: boolean;
        remainingRank: number | null;
        question: number;
        total: number;
      };
    }>;
  return { page, inspect };
}

it.each([
  ['', '', '', false, false, null],
  ['2', '1', '', false, false, 3],
  ['2', '1', '3', true, false, null],
  ['1', '1', '', false, true, null],
])(
  'reads ranking controls without changing answers or assuming sentence position is priority (%s/%s/%s)',
  async (first, second, third, complete, duplicate, remainingRank) => {
    const phrases = [
      'Raramente me sinto irritado',
      'Sinto-me confortável quando estou ao lado de outras pessoas',
      'Lido de forma tranquila com desafios que surgem no dia-a-dia',
    ];
    const html =
      '<p>QUESTÃO 1 DE 21</p><h1>Ordene os itens de acordo com suas preferências:</h1><p>Considere 1 muito importante e 3 menos importante</p>' +
      phrases
        .map(
          (phrase, index) =>
            `<div data-row>${phrase}<select>${['', '1', '2', '3'].map((rank) => `<option value="${rank}" ${rank === [first, second, third][index] ? 'selected' : ''}>${rank}</option>`).join('')}</select></div>`,
        )
        .join('') +
      '<button onclick="window.advanced=true">Próximo passo</button>';
    const h = await setup(html);
    try {
      const found = await h.inspect();
      expect(found).toMatchObject({
        kind: 'assessment-ready',
        reason: 'ranking',
        ranking: { complete, duplicate, remainingRank, question: 1, total: 21 },
      });
      expect(found.ranking?.items.map((item) => item.statement)).toEqual(
        phrases,
      );
      await h.page
        .locator('[data-row]')
        .first()
        .evaluate((row) =>
          row.parentElement!.insertBefore(row.nextElementSibling!, row),
        );
      const reordered = await h.inspect();
      expect(reordered.ranking?.items[0].statement).toBe(phrases[1]);
      expect(reordered.ranking?.items[0].rank).toBe(
        second ? Number(second) : null,
      );
      expect(
        await h.page.evaluate(
          () => (window as unknown as { advanced?: boolean }).advanced,
        ),
      ).toBeUndefined();
    } finally {
      await h.page.close();
    }
  },
);

it.each([
  ['Vamos mapear o seu perfil?', 'Iniciar teste', 'intro'],
  ['Encontre seu lugar calmo', 'Próximo', 'tip-1'],
  ['A internet está okay?', 'Próximo', 'tip-2'],
  ['Reserve 15 minutinhos', 'Próximo', 'tip-3'],
])(
  'recognizes only the known preparation screen %s',
  async (title, button, stage) => {
    const h = await setup(
      `<h1>${title}</h1><button onclick="window.clicked=true">${button}</button>`,
    );
    try {
      const found = await h.inspect();
      expect(found).toMatchObject({ kind: 'assessment-step', stage });
      expect((await h.inspect(found.key)).kind).toBe('clicked');
      expect(
        await h.page.evaluate(
          () => (window as unknown as { clicked?: boolean }).clicked,
        ),
      ).toBe(true);
    } finally {
      await h.page.close();
    }
  },
);
it('waits for a disabled preparation button and rejects a stale stage key', async () => {
  const h = await setup(
    '<h1>Encontre seu lugar calmo</h1><button disabled>Próximo</button>',
  );
  try {
    expect((await h.inspect()).kind).toBe('waiting');
    await h.page
      .locator('button')
      .evaluate((el) => ((el as HTMLButtonElement).disabled = false));
    const found = await h.inspect();
    await h.page
      .locator('h1')
      .evaluate((el) => (el.textContent = 'A internet está okay?'));
    expect((await h.inspect(found.key)).kind).toBe('changed');
  } finally {
    await h.page.close();
  }
});
it('stops at Começar a responder and never clicks it, even when provided a click key', async () => {
  const h = await setup(
    '<h1>E agora, como vai funcionar?</h1><button onclick="window.started=true">Começar a responder</button>',
  );
  try {
    expect(await h.inspect('anything')).toMatchObject({
      kind: 'assessment-ready',
      reason: 'ready',
    });
    expect(
      await h.page.evaluate(
        () => (window as unknown as { started?: boolean }).started,
      ),
    ).toBeUndefined();
  } finally {
    await h.page.close();
  }
});
it('does not click question Next or a technical test beside a behavioral card', async () => {
  const h = await setup(
    '<section><h2>Mapeamento Comportamental</h2><button disabled>Iniciar teste</button></section><section><h2>Teste técnico</h2><button onclick="window.wrong=true">Iniciar teste</button></section>',
    'https://company.gupy.io/candidates/applications/123',
  );
  try {
    expect((await h.inspect()).kind).not.toBe('assessment-step');
    expect(
      await h.page.evaluate(
        () => (window as unknown as { wrong?: boolean }).wrong,
      ),
    ).toBeUndefined();
  } finally {
    await h.page.close();
  }
});
it.each([
  'https://other.example/behavioral/sample',
  'https://assessments.gupy.io/technical/sample',
])('does not enable preparation actions on unrelated URL %s', async (url) => {
  const h = await setup(
    '<h1>Vamos mapear o seu perfil?</h1><button>Iniciar teste</button>',
    url,
  );
  try {
    expect((await h.inspect()).kind).not.toBe('assessment-step');
  } finally {
    await h.page.close();
  }
});
