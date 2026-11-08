import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { formFillDefaultsSchema, emptyFormFillDefaults } from '@recruit/shared';
import { serializePlan } from './native-chrome.service';
import { APPLICATION_ACTION_LABEL } from './application-navigation';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
jest.setTimeout(15000);
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
it('waits for district to become districtBr when Brazil was already selected before starting', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://solutis.inhire.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<input name="country" value="Brasil (BR)"><label>Cidade<input name="district" disabled></label>',
      }),
    );
    await page.goto('https://solutis.inhire.app/vagas/test');
    await page.evaluate(() => {
      setTimeout(() => {
        document.querySelector('[name=district]')!.outerHTML =
          '<div class="react-dropdown-select"><div class="react-dropdown-select-content">Informe sua cidade</div><input name="districtBr" value=""></div>';
        const root = document.querySelector('.react-dropdown-select')!;
        root.addEventListener('click', () => {
          if (root.querySelector('.react-dropdown-select-dropdown')) return;
          const menu = document.createElement('div');
          menu.className = 'react-dropdown-select-dropdown';
          const search = document.createElement('input');
          search.placeholder = 'Pesquisar';
          menu.append(search);
          search.addEventListener('input', () => {
            if (search.value !== 'Uberlândia') return;
            const option = document.createElement('button');
            option.type = 'button';
            option.role = 'option';
            option.setAttribute('aria-label', 'Uberlândia - MG');
            option.textContent = 'Uberlândia - MG';
            option.onclick = (event) => {
              event.stopPropagation();
              root.querySelector<HTMLInputElement>('[name=districtBr]')!.value =
                'Uberlândia - MG';
              menu.remove();
            };
            menu.append(option);
          });
          root.append(menu);
        });
      }, 500);
    });
    await page.addScriptTag({
      content: (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension/fill.js'),
          'utf8',
        )
      ).replace('export ', ''),
    });
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
    const report: unknown = await page.evaluate(
      (plan) =>
        (
          window as unknown as {
            fillCurrentDocument: (p: unknown) => Promise<unknown>;
          }
        ).fillCurrentDocument(plan),
      { fields, blocked: NEVER_FILL.source },
    );
    expect((report as { filled: string[] }).filled).toContain('localização');
    expect(await page.locator('[name=districtBr]').inputValue()).toBe(
      'Uberlândia - MG',
    );
    expect(await page.locator('[name=country]').inputValue()).toBe(
      'Brasil (BR)',
    );
  } finally {
    await page.close();
  }
});
it('selects the configured country option, fills CPF and refreshes the newly enabled city field', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://solutis.inhire.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<div class="react-dropdown-select" tabindex="0" aria-expanded="false"><div class="react-dropdown-select-content">Selecione o país</div><input name="country" tabindex="-1" value="" style="opacity:0;width:0"></div><div data-component-name="Flex"><div><label>CPF <span>*</span></label></div><div name="document.value"><input name="document.value" placeholder="000.000.000-00"></div></div><label>Cidade*<input name="district" disabled></label><button>Enviar</button>`,
      }),
    );
    await page.goto('https://solutis.inhire.app/vagas/test');
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(
        '.react-dropdown-select',
      )!;
      root.addEventListener('click', () => {
        if (root.querySelector('.react-dropdown-select-dropdown')) return;
        setTimeout(() => {
          const list = document.createElement('div');
          list.className = 'react-dropdown-select-dropdown';
          list.innerHTML =
            '<button role="option" type="button"><span data-component-name="Truncate" title="Argentina (AR)">Argentina (AR)</span></button><button role="option" type="button" data-country="BR"><span data-component-name="Truncate" title="Brasil (BR)">Brasil (BR)</span></button>';
          list
            .querySelector('[data-country="BR"]')!
            .addEventListener('click', (event) => {
              event.stopPropagation();
              root.querySelector<HTMLInputElement>('input')!.value = 'BR';
              root.querySelector(
                '.react-dropdown-select-content',
              )!.textContent = 'Brasil (BR)';
              list.remove();
              setTimeout(() => {
                document.querySelector('[name=district]')!.outerHTML =
                  '<div class="react-dropdown-select" id="city-select"><div class="react-dropdown-select-content">Informe sua cidade</div><input name="districtBr" tabindex="-1" value="" style="opacity:0;width:0"></div>';
                const city = document.querySelector('#city-select')!;
                city.addEventListener('click', () => {
                  if (city.querySelector('.react-dropdown-select-dropdown'))
                    return;
                  const menu = document.createElement('div');
                  menu.className = 'react-dropdown-select-dropdown';
                  const search = document.createElement('input');
                  search.placeholder = 'Pesquisar';
                  menu.append(search);
                  search.addEventListener('input', () => {
                    if (search.value !== 'Uberlândia') return;
                    for (const name of ['Uberlândia - SP', 'Uberlândia - MG']) {
                      const option = document.createElement('button');
                      option.type = 'button';
                      option.role = 'option';
                      option.textContent = name;
                      option.setAttribute('aria-label', name);
                      option.onclick = (event) => {
                        event.stopPropagation();
                        city.querySelector<HTMLInputElement>(
                          '[name=districtBr]',
                        )!.value = name;
                        city.querySelector(
                          '.react-dropdown-select-content',
                        )!.textContent = name;
                        menu.remove();
                      };
                      menu.append(option);
                    }
                  });
                  city.append(menu);
                });
              }, 400);
              (
                window as unknown as { selectedCountry: boolean }
              ).selectedCountry = true;
            });
          root.append(list);
        }, 200);
      });
    });
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
      cpf: '529.982.247-25',
      countryOfOrigin: 'Brasil',
    });
    const fields = serializePlan(
      buildFieldPlan({
        name: 'Pessoa',
        email: null,
        phone: null,
        location: 'Uberlândia, MG',
        links: null,
        resume: null,
        defaults,
      }),
    );
    const report: unknown = await page.evaluate(
      (plan) =>
        (
          window as unknown as {
            fillCurrentDocument: (p: unknown) => Promise<unknown>;
          }
        ).fillCurrentDocument(plan),
      { fields, blocked: NEVER_FILL.source },
    );
    expect((report as { filled: string[] }).filled).toEqual(
      expect.arrayContaining(['CPF', 'país de origem', 'localização']),
    );
    expect(await page.locator('[name=country]').inputValue()).toBe('BR');
    expect(
      await page.locator('input[name="document.value"]').inputValue(),
    ).toBe('529.982.247-25');
    expect(await page.locator('[name=districtBr]').inputValue()).toBe(
      'Uberlândia - MG',
    );
    expect(
      await page.evaluate(() => Object.hasOwn(window, 'selectedCountry')),
    ).toBe(true);
  } finally {
    await page.close();
  }
});
it('validates CPF and keeps old saved defaults compatible without inventing personal data', () => {
  const old = {
    fullName: 'Pessoa',
    salaryExpectation: null,
    experienceSummary: null,
  };
  expect(formFillDefaultsSchema.safeParse(old).success).toBe(true);
  expect(
    formFillDefaultsSchema.safeParse({ ...old, cpf: '11111111111' }).success,
  ).toBe(false);
  expect(
    formFillDefaultsSchema.safeParse({ ...old, cpf: '52998224724' }).success,
  ).toBe(false);
  expect(
    formFillDefaultsSchema.safeParse({ ...old, cpf: '52998224725' }).success,
  ).toBe(true);
  const fields = buildFieldPlan({
    name: 'Pessoa',
    email: null,
    phone: null,
    location: 'Uberlândia, MG',
    links: null,
    resume: null,
    defaults: old,
  });
  expect(
    fields.some((field) => ['CPF', 'país de origem'].includes(field.what)),
  ).toBe(false);
});
it('preserves an already selected country and does not place CPF into a foreign document field', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://solutis.inhire.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<div class="react-dropdown-select"><input name="country" value="PT"></div><input type="checkbox" name="isNotBrazilian" checked><div data-component-name="Flex"><label>Passaporte</label><input name="document.value"></div>',
      }),
    );
    await page.goto('https://solutis.inhire.app/vagas/test');
    await page.addScriptTag({
      content: (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension/fill.js'),
          'utf8',
        )
      ).replace('export ', ''),
    });
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
          cpf: '52998224725',
          countryOfOrigin: 'Brasil',
        },
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
    expect(await page.locator('[name=country]').inputValue()).toBe('PT');
    expect(await page.locator('[name="document.value"]').inputValue()).toBe('');
  } finally {
    await page.close();
  }
});
it('recognizes the Solutis form and fills known fields while reporting personal answers left to the user', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://solutis.inhire.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<button type="button" style="display:none">Candidatar-se para a vaga</button>
<form><label for="name">Nome completo*</label><input id="name" name="name" placeholder="Seu nome completo">
<label>CPF*</label><input name="document.value" placeholder="000.000.000-00">
<label for="email">Seu melhor email*</label><input id="email" name="email" type="email" placeholder="Seu melhor email">
<input type="tel" name="phone" value="+55" placeholder="Celular com DDD">
<label>LinkedIn<input name="linkedinUsername"></label>
<input name="country" value="" tabindex="-1" style="opacity:0;width:0">
<label>Cidade*<input name="district" disabled placeholder="Informe sua cidade"></label>
<input type="file" name="resume" required style="display:none">
<label>Pretensão salarial como CLT*<input name="salaryExpectation" placeholder="R$ 0.000,00"></label>
<button type="button" disabled>Avançar</button></form>`,
      }),
    );
    await page.goto('https://solutis.inhire.app/vagas/example');
    for (const file of ['navigation.js', 'fill.js'])
      await page.addScriptTag({
        content: (
          await readFile(
            join(process.cwd(), '..', 'chrome-extension', file),
            'utf8',
          )
        ).replace('export ', ''),
      });
    const inspect = (phase: string) =>
      page.evaluate(
        ({ phase, apply }) =>
          (
            window as unknown as {
              inspectApplicationDocument: (
                n: unknown,
                k: null,
                p: string,
              ) => { kind: string; missing?: string[] };
            }
          ).inspectApplicationDocument({ apply }, null, phase),
        { phase, apply: APPLICATION_ACTION_LABEL.source },
      );
    expect((await inspect('discover')).kind).toBe('form');
    const fields = serializePlan(
      buildFieldPlan({
        name: 'Pessoa Teste',
        email: 'test@example.com',
        phone: '34999990000',
        location: 'Uberlândia, MG',
        links: { linkedin: 'https://linkedin.com/in/test' },
        resume: null,
        defaults: { salaryExpectation: 'R$ 5.000' },
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
    expect(await page.locator('#name').inputValue()).toBe('Pessoa Teste');
    expect(await page.locator('#email').inputValue()).toBe('test@example.com');
    expect(await page.locator('[name=phone]').inputValue()).toBe(
      '+5534999990000',
    );
    expect(await page.locator('[name=salaryExpectation]').inputValue()).toBe(
      'R$ 5.000',
    );
    const progress = await inspect('progress');
    expect(progress.kind).toBe('review');
    expect(progress.missing).toEqual(
      expect.arrayContaining(['CPF', 'País de origem', 'Currículo PDF']),
    );
    expect(await page.locator('[name="document.value"]').inputValue()).toBe('');
    expect(APPLICATION_ACTION_LABEL.test('Candidatar-se para a vaga')).toBe(
      true,
    );
  } finally {
    await page.close();
  }
});
