import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { APPLICATION_ACTION_LABEL } from './application-navigation';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
async function setup(html: string, host = 'company.gupy.io') {
  const page = await browser.newPage();
  await page.route(`https://${host}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`https://${host}/application`);
  for (const file of ['fill.js', 'navigation.js']) {
    const code = await readFile(
      join(process.cwd(), '..', 'chrome-extension', file),
      'utf8',
    );
    await page.addScriptTag({ content: code.replace('export ', '') });
  }
  return page;
}
const employee = `<fieldset><legend>Você trabalha na empresa Confidencial?</legend>
<label><input type="radio" name="radioGroupIsCompanyEmployeeTitle" value="yes">Sim</label>
<label><input type="radio" name="radioGroupIsCompanyEmployeeTitle" value="no">Não</label></fieldset>`;
async function fill(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        fillCurrentDocument: (p: unknown) => Promise<unknown>;
      }
    ).fillCurrentDocument({ fields: [], blocked: '' }),
  );
}
async function inspectStage(
  page: Page,
  phase = 'progress',
  key: string | null = null,
) {
  return page.evaluate(
    ({ phase, key, apply }) =>
      (
        window as unknown as {
          inspectApplicationDocument: (
            n: unknown,
            k: string | null,
            p: string,
          ) => {
            kind: string;
            signature: string;
            key: string;
            missing?: string[];
          };
        }
      ).inspectApplicationDocument({ apply }, key, phase),
    { phase, key, apply: APPLICATION_ACTION_LABEL.source },
  );
}
it('advances the Gupy additional-data submit without treating it as the final submission', async () => {
  const page = await setup(
    '<h1>Dados adicionais</h1><form onsubmit="event.preventDefault();window.saved=true"><button type="submit">Salvar e continuar</button></form>',
  );
  try {
    expect((await inspectStage(page, 'discover')).kind).toBe('form');
    const step = await inspectStage(page);
    expect(step.kind).toBe('next');
    expect((await inspectStage(page, 'progress', step.key)).kind).toBe(
      'clicked',
    );
    expect(await page.evaluate(() => Object.hasOwn(window, 'saved'))).toBe(
      true,
    );
  } finally {
    await page.close();
  }
});
it('detects the optional presentation dialog, ignores background fields and never finalizes', async () => {
  const page = await setup(
    '<h1>Perguntas criadas pela empresa</h1><button>Responder agora</button>',
  );
  try {
    const before = await inspectStage(page);
    await page.evaluate(() => {
      document.body.innerHTML =
        '<input required aria-label="Campo de fundo"><div role="dialog"><h3>Apresente-se!</h3><p>Opcional</p><button type="button" onclick="window.personalized=true">Personalizar candidatura</button><button type="button" onclick="window.sent=true">Finalizar candidatura</button></div>';
    });
    const step = await inspectStage(page);
    expect(step.signature).not.toBe(before.signature);
    expect(step.kind).toBe('next');
    expect((await inspectStage(page, 'progress', step.key)).kind).toBe(
      'clicked',
    );
    expect(
      await page.evaluate(() => Object.hasOwn(window, 'personalized')),
    ).toBe(true);
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
    await page.evaluate(
      () =>
        (document.querySelector('[role=dialog]')!.innerHTML =
          '<button onclick="window.sent=true">Finalizar candidatura</button>'),
    );
    expect((await inspectStage(page)).kind).toBe('final');
  } finally {
    await page.close();
  }
});
it('leaves referral answers to the user and pauses for the required answer', async () => {
  const page = await setup(
    '<h1>Dados adicionais</h1><fieldset><legend>Alguém que trabalha nesta empresa indicou você para esta vaga?</legend><label><input type="radio" name="referral" required value="yes">Sim</label><label><input type="radio" name="referral" required value="no">Não</label></fieldset><button>Salvar e continuar</button>',
  );
  try {
    await fill(page);
    expect(await page.locator('input:checked').count()).toBe(0);
    expect((await inspectStage(page)).kind).toBe('review');
  } finally {
    await page.close();
  }
});
it('uses only the configured summary for a generic presentation and preserves company-specific questions', async () => {
  const page = await setup(
    '<div role="dialog"><label>Apresente-se!<textarea id="intro"></textarea></label><label>Por que deseja trabalhar na nossa empresa?<textarea id="custom"></textarea></label><button>Finalizar candidatura</button></div>',
  );
  try {
    await page.evaluate(
      (summary) =>
        (
          window as unknown as {
            fillCurrentDocument: (p: unknown) => Promise<unknown>;
          }
        ).fillCurrentDocument({
          fields: [
            {
              what: 'resumo de experiência',
              value: summary,
              labels: '^Resumo profissional$',
              flags: 'i',
            },
          ],
          blocked: 'por que|carta',
        }),
      'Resumo profissional configurado',
    );
    expect(await page.locator('#intro').inputValue()).toBe(
      'Resumo profissional configurado',
    );
    expect(await page.locator('#custom').inputValue()).toBe('');
    expect((await inspectStage(page)).kind).toBe('final');
  } finally {
    await page.close();
  }
});
it('selects employee No and the actual LinkedIn combobox option, including a delayed portal', async () => {
  const page =
    await setup(`${employee}<label id="source-label">Onde você encontrou essa vaga? (Opcional)</label>
<input name="howDidYouHearAboutUs" role="combobox" aria-labelledby="source-label" aria-controls="sources">
<fieldset><legend>Tem disponibilidade para viajar?</legend><label><input id="unrelated" type="radio" name="travel" value="no">Não</label></fieldset>`);
  try {
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[role=combobox]',
      )!;
      input.addEventListener('click', () => {
        setTimeout(() => {
          const list = document.createElement('div');
          list.id = 'sources';
          list.setAttribute('role', 'listbox');
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = 'LinkedIn';
          option.addEventListener('click', () => {
            input.value = 'LinkedIn';
            (window as unknown as { selected: boolean }).selected = true;
            list.remove();
          });
          list.append(option);
          document.body.append(list);
        }, 150);
      });
    });
    expect(await fill(page)).toMatchObject({
      filled: ['funcionário da empresa: Não', 'origem da vaga: LinkedIn'],
      submitted: false,
    });
    expect(
      await page
        .locator('input[value=no][name=radioGroupIsCompanyEmployeeTitle]')
        .isChecked(),
    ).toBe(true);
    expect(await page.locator('input[role=combobox]').inputValue()).toBe(
      'LinkedIn',
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { selected: boolean }).selected,
      ),
    ).toBe(true);
    expect(await page.locator('#unrelated').isChecked()).toBe(false);
  } finally {
    await page.close();
  }
});
it('preserves existing employee and source answers', async () => {
  const page = await setup(
    employee.replace('value="yes"', 'value="yes" checked') +
      '<input label="Onde você encontrou essa vaga? (Opcional)" name="howDidYouHearAboutUs" role="combobox" value="Indicação">',
  );
  try {
    await fill(page);
    expect(await page.locator('input[value=yes]').isChecked()).toBe(true);
    expect(await page.locator('input[role=combobox]').inputValue()).toBe(
      'Indicação',
    );
  } finally {
    await page.close();
  }
});
it('does not apply the Gupy answers to unrelated sites', async () => {
  const page = await setup(employee, 'other.example.com');
  try {
    await fill(page);
    expect(await page.locator('input:checked').count()).toBe(0);
  } finally {
    await page.close();
  }
});
it('opens Responder agora and recognizes the following employee-only form', async () => {
  const page = await setup(
    `<button aria-label="Responder agora" onclick="document.body.innerHTML=window.formHtml">Responder agora</button>`,
  );
  try {
    await page.evaluate((html) => {
      (window as unknown as { formHtml: string }).formHtml = html;
    }, employee);
    expect((await inspectStage(page, 'discover')).kind).toBe('form');
    const found = await inspectStage(page);
    expect(found.kind).toBe('next');
    expect((await inspectStage(page, 'progress', found.key)).kind).toBe(
      'clicked',
    );
    expect((await inspectStage(page, 'discover')).kind).toBe('form');
    await fill(page);
    expect(await page.locator('input[value=no]').isChecked()).toBe(true);
    expect(APPLICATION_ACTION_LABEL.test('Responder agora')).toBe(true);
  } finally {
    await page.close();
  }
});
it('recognizes Responder agora within a form as a continuation without submitting', async () => {
  const page = await setup(
    '<form onsubmit="window.sent=true;return false"><button type="button" aria-label="Responder agora" onclick="window.opened=true">Responder agora</button><button type="submit">Enviar</button></form>',
  );
  try {
    const inspect = (phase: string, key: string | null = null) =>
      page.evaluate(
        ({ phase, key, apply }) =>
          (
            window as unknown as {
              inspectApplicationDocument: (
                n: unknown,
                k: string | null,
                p: string,
              ) => { kind: string; key: string };
            }
          ).inspectApplicationDocument({ apply }, key, phase),
        { phase, key, apply: APPLICATION_ACTION_LABEL.source },
      );
    expect((await inspect('discover')).kind).toBe('form');
    const step = await inspect('progress');
    expect(step.kind).toBe('next');
    expect((await inspect('progress', step.key)).kind).toBe('clicked');
    expect(await page.evaluate(() => Object.hasOwn(window, 'opened'))).toBe(
      true,
    );
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await page.close();
  }
});
