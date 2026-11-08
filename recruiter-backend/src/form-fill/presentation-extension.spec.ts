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
const html =
  '<h1>Apresente-se!</h1><p>Fale sobre você e sua trajetória profissional, contando como pode ajudar a empresa no desafio descrito na vaga.</p><div class="form-group textarea"><div class="form-group__content"><textarea id="personalization-step-text-area" aria-required="false" placeholder="Escreva aqui..." rows="5" maxlength="1500"></textarea></div></div><label>Por que deseja esta vaga?<textarea id="other"></textarea></label><button onclick="window.sent=true">Finalizar candidatura</button>';
async function setup(host = 'company.gupy.io') {
  const page = await browser.newPage();
  await page.route('https://**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(`https://${host}/candidates/applications/123/curriculum`);
  const source = await readFile(
    join(process.cwd(), '..', 'chrome-extension/presentation.js'),
    'utf8',
  );
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Page.getFrameTree');
  const world = await session.send('Page.createIsolatedWorld', {
    frameId: tree.frameTree.frame.id,
    worldName: 'jobtracker-presentation',
  });
  const run = async (text: string | null = null) => {
    const result = await session.send('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression:
        source.replace('export ', '') +
        `;presentationDocument(${JSON.stringify(text)})`,
      returnByValue: true,
    });
    return result.result.value as {
      kind: string;
      maxChars?: number;
      generated?: boolean;
    };
  };
  return { page, run };
}
it('recognizes the pasted Gupy control without a label and fills in the extension isolated world without submitting', async () => {
  const h = await setup();
  try {
    expect(await h.run()).toEqual({ kind: 'empty', maxChars: 1500 });
    expect(await h.run('Atuo com suporte técnico e redes.')).toEqual({
      kind: 'filled',
      generated: true,
    });
    expect(
      await h.page.locator('#personalization-step-text-area').inputValue(),
    ).toContain('suporte técnico');
    expect(await h.page.locator('#other').inputValue()).toBe('');
    expect(
      await h.page.evaluate(
        () => (window as unknown as { sent?: boolean }).sent,
      ),
    ).toBeUndefined();
  } finally {
    await h.page.close();
  }
});
it('preserves manual edits made while the draft is being generated and respects maxlength', async () => {
  const h = await setup();
  try {
    expect((await h.run('a'.repeat(1501))).kind).toBe('invalid');
    await h.page
      .locator('#personalization-step-text-area')
      .fill('Minha apresentação revisada');
    expect(await h.run('Outro texto gerado')).toEqual({ kind: 'filled' });
    expect(
      await h.page.locator('#personalization-step-text-area').inputValue(),
    ).toBe('Minha apresentação revisada');
  } finally {
    await h.page.close();
  }
});
it('does not use similarly named controls on unrelated sites', async () => {
  const h = await setup('untrusted.example');
  try {
    expect(await h.run()).toEqual({ kind: 'missing' });
  } finally {
    await h.page.close();
  }
});
