import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import {
  emptyFormFillDefaults,
  formFillDefaultsSchema,
  type FormFillDefaults,
} from '@recruit/shared';
import { buildFieldPlan } from './field-plan';
import { serializePlan } from './native-chrome.service';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const configured: FormFillDefaults = {
  ...emptyFormFillDefaults,
  disabilityStatus: 'Sim',
  disabilityCid: 'TEST-CID',
  race: 'Parda',
  sex: 'Masculino',
  genderIdentity: 'Mulher transgênero',
  sexualOrientation: 'Bissexual',
};
const fields = (defaults: FormFillDefaults = configured) =>
  buildFieldPlan({
    name: 'Pessoa Teste',
    email: null,
    phone: null,
    location: null,
    links: null,
    resume: null,
    defaults,
  }).filter((field) => field.sensitive);
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
async function setup(html: string) {
  const page = await browser.newPage();
  await page.route('https://company.gupy.io/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto('https://company.gupy.io/application');
  const source = await readFile(
    join(process.cwd(), '..', 'chrome-extension/fill.js'),
    'utf8',
  );
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Page.getFrameTree');
  const world = await session.send('Page.createIsolatedWorld', {
    frameId: tree.frameTree.frame.id,
    worldName: 'jobtracker-demographics',
  });
  const fill = async (defaults: FormFillDefaults = configured) => {
    const plan = {
      fields: serializePlan(fields(defaults)),
      blocked: 'por que|carta',
      facts: {},
    };
    const result = await session.send('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression:
        source.replace('export ', '') +
        `;fillCurrentDocument(${JSON.stringify(plan)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text +
          JSON.stringify(result.exceptionDetails.exception),
      );
    return result.result.value as {
      filled: string[];
      skipped: string[];
      needsReview: string[];
    };
  };
  return { page, fill };
}

it('accepts old profiles without assigning a demographic answer and only plans explicit saved choices', () => {
  expect(
    formFillDefaultsSchema.safeParse({
      fullName: null,
      salaryExpectation: null,
      experienceSummary: null,
    }).success,
  ).toBe(true);
  expect(fields(emptyFormFillDefaults)).toHaveLength(0);
  expect(fields().map((field) => field.what)).toEqual([
    'PCD',
    'CID',
    'cor ou raça',
    'sexo',
    'identidade de gênero',
    'orientação sexual',
  ]);
  expect(
    fields({ ...configured, disabilityStatus: 'Não' }).some(
      (field) => field.what === 'CID',
    ),
  ).toBe(false);
  expect(
    fields({ ...configured, disabilityStatus: null }).some(
      (field) => field.what === 'CID',
    ),
  ).toBe(false);
  expect(
    formFillDefaultsSchema.safeParse({ ...configured, race: 'inferida' })
      .success,
  ).toBe(false);
});

it('fills PCD, delayed CID, native select, sex and gender radio groups, and an actual orientation option in isolated Chrome', async () => {
  const h =
    await setup(`<fieldset><legend>Você é uma pessoa com deficiência (PCD)?</legend><label><input id="pcd-yes" type="radio" name="pcd" value="yes" onchange="setTimeout(()=>document.querySelector('#cid').disabled=false,200)">Sim</label><label><input type="radio" name="pcd" value="no">Não</label></fieldset>
  <label>CID<input id="cid" disabled></label>
  <label>Cor ou raça<select id="race"><option value="">Selecione</option><option value="3">Pardo(a)</option></select></label>
  <fieldset><legend>Sexo</legend><label><input id="sex-m" type="radio" name="sex" value="1">Masculino</label><label><input type="radio" name="sex" value="2">Feminino</label></fieldset>
  <fieldset><legend>Identidade de gênero</legend><label><input type="radio" name="gender" value="1">Homem cisgênero</label><label><input id="gender-t" type="radio" name="gender" value="2">Mulher transgênero</label></fieldset>
  <label>Orientação sexual<input id="orientation" role="combobox" aria-controls="orientation-options"></label>
  <button onclick="window.sent=true">Finalizar candidatura</button>`);
  try {
    await h.page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#orientation')!;
      input.addEventListener('click', () =>
        setTimeout(() => {
          const list = document.createElement('div');
          list.id = 'orientation-options';
          list.setAttribute('role', 'listbox');
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = 'Bissexual';
          option.addEventListener('click', () => {
            input.value = 'Bissexual';
            list.remove();
          });
          list.append(option);
          document.body.append(list);
        }, 100),
      );
    });
    const report = await h.fill();
    expect(report.filled).toEqual([
      'PCD',
      'CID',
      'cor ou raça',
      'sexo',
      'identidade de gênero',
      'orientação sexual',
    ]);
    expect(await h.page.locator('#pcd-yes').isChecked()).toBe(true);
    expect(await h.page.locator('#cid').inputValue()).toBe('TEST-CID');
    expect(await h.page.locator('#race').inputValue()).toBe('3');
    expect(await h.page.locator('#sex-m').isChecked()).toBe(true);
    expect(await h.page.locator('#gender-t').isChecked()).toBe(true);
    expect(await h.page.locator('#orientation').inputValue()).toBe('Bissexual');
    expect(
      await h.page.evaluate(
        () => (window as unknown as { sent?: boolean }).sent,
      ),
    ).toBeUndefined();
  } finally {
    await h.page.close();
  }
});

it('treats prefer not to disclose as an explicit answer, separately from No and from an unconfigured field', async () => {
  const h = await setup(
    '<fieldset><legend>PCD</legend><label><input type="radio" name="pcd" value="no">Não</label><label><input id="decline" type="radio" name="pcd" value="decline">Prefiro não responder</label></fieldset><label>Orientação sexual<select id="orientation"><option value="">Selecione</option><option value="no">Não</option><option value="decline">Prefiro não informar</option></select></label>',
  );
  try {
    await h.fill({
      ...emptyFormFillDefaults,
      disabilityStatus: 'Prefiro não informar',
      sexualOrientation: 'Prefiro não informar',
    });
    expect(await h.page.locator('#decline').isChecked()).toBe(true);
    expect(await h.page.locator('#orientation').inputValue()).toBe('decline');
  } finally {
    await h.page.close();
  }
});

it('preserves existing choices and never derives gender identity from sex', async () => {
  const h = await setup(
    '<fieldset><legend>Sexo</legend><label><input id="existing" type="radio" name="sex" checked>Feminino</label><label><input type="radio" name="sex">Masculino</label></fieldset><label>Identidade de gênero<select id="gender"><option value="">Selecione</option><option value="male">Masculino</option></select></label><label>Cor ou raça<select id="race"><option value="white" selected>Branca</option><option value="brown">Parda</option></select></label><label>Orientação sexual<input role="combobox" id="orientation" value="Gay"></label>',
  );
  try {
    const report = await h.fill();
    expect(await h.page.locator('#existing').isChecked()).toBe(true);
    expect(await h.page.locator('#race').inputValue()).toBe('white');
    expect(await h.page.locator('#gender').inputValue()).toBe('');
    expect(await h.page.locator('#orientation').inputValue()).toBe('Gay');
    expect(report.needsReview).toContain('identidade de gênero');
  } finally {
    await h.page.close();
  }
});

it('does not classify from field names, option values, or nearby unrelated questions', async () => {
  const h = await setup(
    '<input name="sexualOrientation" id="unlabelled"><label>Você tem disponibilidade para atender pessoas com deficiência?<select id="unrelated"><option value="">Selecione</option><option value="yes">Sim</option></select></label><label>Orientação sexual<select id="orientation"><option value="">Selecione</option><option value="Bissexual">Outra orientação</option></select></label><label>CID<input id="cid"></label>',
  );
  try {
    await h.fill({ ...configured, disabilityStatus: 'Não' });
    expect(await h.page.locator('#unlabelled').inputValue()).toBe('');
    expect(await h.page.locator('#unrelated').inputValue()).toBe('');
    expect(await h.page.locator('#orientation').inputValue()).toBe('');
    expect(await h.page.locator('#cid').inputValue()).toBe('');
  } finally {
    await h.page.close();
  }
});

it('does not disclose the saved CID when the page already says No to PCD', async () => {
  const h = await setup(
    '<fieldset><legend>PCD</legend><label><input type="radio" name="pcd">Sim</label><label><input type="radio" id="no" name="pcd" checked>Não</label></fieldset><label>CID<input id="cid"></label>',
  );
  try {
    await h.fill();
    expect(await h.page.locator('#no').isChecked()).toBe(true);
    expect(await h.page.locator('#cid').inputValue()).toBe('');
  } finally {
    await h.page.close();
  }
});
