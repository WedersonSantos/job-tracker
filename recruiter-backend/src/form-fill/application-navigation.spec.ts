import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import {
  findApplicationPage,
  guardApplicationNavigation,
} from './application-navigation';
import { assertReachable } from '../job/safe-fetch';
import { FormFillService } from './form-fill.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResumeFileService } from '../profile/resume-file.service';
import { attachResume } from './resume-upload';
import { emptyLinks } from '@recruit/shared';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../profile/resume-file.service', () => ({
  ResumeFileService: class {},
}));

jest.mock('../job/safe-fetch', () => ({
  assertReachable: jest.fn((url: URL) => {
    if (url.hostname === '127.0.0.1')
      return Promise.reject(new Error('private address'));
    return Promise.resolve();
  }),
}));

const form =
  '<form><label>Full name<input name="name"></label><label>Email<input type="email"></label><button>Apply now</button></form>';

describe('application navigation in Chrome', () => {
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }, 30_000);
  beforeEach(async () => {
    context = await browser.newContext();
  });
  afterEach(async () => {
    await context.close();
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function fixture(pages: Record<string, string>) {
    await context.route('https://example.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: pages[new URL(route.request().url()).pathname] ?? '',
      }),
    );
    const page = await context.newPage();
    await page.goto('https://example.com/start');
    return page;
  }

  it('follows the Indeed company-site link, redirects, then opens the company application form', async () => {
    const page = await fixture({
      '/start':
        '<div data-testid="primary-apply-action"><a data-testid="viewjob-apply" target="_blank" href="https://br.indeed.com/applystart?jk=test"><div>Candidatar-se no site da empresa</div></a></div>',
      '/company': '<a href="/application">Candidatar-se ao cargo</a>',
      '/application': form,
    });
    await context.route('https://br.indeed.com/applystart**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: "<script>location.replace('https://example.com/company')</script>",
      }),
    );
    const result = await findApplicationPage(page);
    expect(result.page).not.toBe(page);
    expect(result.page.url()).toBe('https://example.com/application');
    expect(result.message).toBeUndefined();
    expect(await result.page.locator('input[name=name]').inputValue()).toBe('');
  }, 15000);

  it('does not treat the company-site label inside a form as a navigation control', async () => {
    const page = await fixture({
      '/start':
        '<form onsubmit="window.sent=true;return false"><button>Candidatar-se no site da empresa</button></form>',
    });
    const result = await findApplicationPage(page);
    expect(result.message).toContain('Não encontrei');
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  }, 10000);

  it('clicks Google sign-in even when candidate fields or a password are present', async () => {
    const page = await fixture({
      '/start':
        '<form><input type="password"><button type="button" onclick="location.href=\'/application\'"><span>Entrar com o Google</span></button></form>' +
        form,
      '/application': form,
    });
    const result = await findApplicationPage(page);
    expect(result.page.url()).toBe('https://example.com/application');
    expect(result.message).toBeUndefined();
  });

  it('leaves Google account selection to the user', async () => {
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: 'Choose an account' }),
    );
    const page = await fixture({
      '/start':
        '<a target="_blank" href="https://accounts.google.com/login">Entrar com o Google</a>',
    });
    const result = await findApplicationPage(page);
    expect(result.page.url()).toBe('https://accounts.google.com/login');
    expect(result.message).toContain('Conclua a entrada');
  });

  it('attaches a PDF to a hidden resume input without touching the cover letter', async () => {
    const page = await fixture({
      '/start':
        '<form><input type="file" name="resume" hidden><input type="file" name="cover_letter"><button>Submit application</button></form>',
    });
    const result = await attachResume(page, {
      name: 'curriculo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    expect(result.status).toBe('attached');
    expect(
      await page
        .locator('[name=resume]')
        .evaluate((e) => (e as HTMLInputElement).files?.[0].name),
    ).toBe('curriculo.pdf');
    expect(
      await page
        .locator('[name=cover_letter]')
        .evaluate((e) => (e as HTMLInputElement).files?.length),
    ).toBe(0);
  });

  it('uses the file chooser opened by Carregar currículo', async () => {
    const page = await fixture({
      '/start':
        '<form><input id="attachment" type="file" hidden><a href="#" onclick="event.preventDefault();document.getElementById(\'attachment\').click()"><span>Carregar currículo</span><span>*</span></a></form>',
    });
    expect((await findApplicationPage(page)).message).toBeUndefined();
    const result = await attachResume(page, {
      name: 'curriculo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    expect(result.status).toBe('attached');
    expect(
      await page
        .locator('#attachment')
        .evaluate((e) => (e as HTMLInputElement).files?.[0].name),
    ).toBe('curriculo.pdf');
  });

  it('does not click upload-labelled submit buttons or replace an already selected PDF', async () => {
    const page = await fixture({
      '/start':
        '<form onsubmit="window.sent=true;return false"><input type="file" name="resume"><button>Carregar currículo</button></form>',
    });
    const file = {
      name: 'original.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    };
    await page.locator('[name=resume]').setInputFiles(file);
    expect(
      (await attachResume(page, { ...file, name: 'new.pdf' })).status,
    ).toBe('skipped');
    await page.locator('[name=resume]').evaluate((e) => e.remove());
    expect((await attachResume(page, file)).status).toBe('skipped');
    expect(await page.evaluate('window.sent')).toBeUndefined();
  });

  it('follows an aggregator popup and an ATS button, stopping before submission', async () => {
    const page = await fixture({
      '/start':
        '<a target="_blank" href="/ats"><font><font>Candidate-se a esta vaga</font></font></a>',
      '/ats':
        '<button type="button" onclick="location.href=\'/application\'">Candidatar-se ao cargo</button>',
      '/application':
        form +
        '<script>document.querySelector("form").onsubmit=()=>{window.sent=true;return false}</script>',
    });
    const result = await findApplicationPage(page);
    expect(result.message).toBeUndefined();
    expect(result.page.url()).toBe('https://example.com/application');
    expect(await result.page.evaluate('window.sent')).toBeUndefined();
    expect(context.pages()).toHaveLength(2);
  }, 20_000);

  it('waits for a form rendered asynchronously without clicking its Apply button', async () => {
    const page = await fixture({
      '/start': `<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(form)},400)</script>`,
    });
    expect((await findApplicationPage(page)).message).toBeUndefined();
    expect(page.url()).toBe('https://example.com/start');
  });

  it('fills the four saved professional links into separate fields', async () => {
    await fixture({
      '/start':
        form +
        '<label>LinkedIn profile<input id="linkedin"></label><input id="github" placeholder="GitHub URL"><label>Portfolio URL *<input id="portfolio_url"></label><label>Video introduction URL<input id="intro_video_url"></label><label>Disponibilidade para entrevista por vídeo<input id="interview"></label>',
    });
    const links = {
      ...emptyLinks,
      linkedin: 'https://linkedin.com/in/pessoa',
      github: 'https://github.com/pessoa',
      website: 'https://example.com/portfolio',
      presentationVideo: 'https://example.com/video',
    };
    const prisma = {
      profile: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Pessoa Teste',
          email: 'teste@example.com',
          phone: null,
          location: null,
          resume: null,
          links,
        }),
      },
    } as unknown as PrismaService;
    const service = new FormFillService(prisma, {
      attachment: jest.fn().mockResolvedValue(null),
    } as unknown as ResumeFileService);
    Object.defineProperty(service, 'window', {
      value: () => Promise.resolve(context),
    });
    const report = await service.fill(
      'test-links',
      'https://example.com/start',
    );
    expect(report.submitted).toBe(false);
    const page = context.pages().at(-1)!;
    for (const [id, value] of Object.entries({
      linkedin: links.linkedin,
      github: links.github,
      portfolio_url: links.website,
      intro_video_url: links.presentationVideo,
    }))
      expect(await page.locator('#' + id).inputValue()).toBe(value);
    expect(await page.locator('#interview').inputValue()).toBe('');
    expect(report.filled.map((f) => f.what)).toEqual(
      expect.arrayContaining([
        'LinkedIn',
        'GitHub',
        'portfólio / site',
        'vídeo de apresentação',
      ]),
    );
  });

  it('recognizes an application embedded in an iframe', async () => {
    const page = await fixture({
      '/start': '<iframe src="/application"></iframe>',
      '/application': form,
    });
    expect((await findApplicationPage(page)).message).toBeUndefined();
  });

  it('stops for login without clicking a button', async () => {
    const page = await fixture({
      '/start': '<input type="password"><a href="/application">Apply now</a>',
      '/application': form,
    });
    expect((await findApplicationPage(page)).message).toContain('login');
    expect(page.url()).toBe('https://example.com/start');
  });

  it('stops for a visible CAPTCHA challenge', async () => {
    const page = await fixture({
      '/start': '<div id="challenge-running">Verify you are human</div>',
    });
    expect((await findApplicationPage(page)).message).toContain('CAPTCHA');
  });

  it('does not submit an unrecognized form or mistake a newsletter for an application', async () => {
    const page = await fixture({
      '/start': '<form><input type="email"><button>Apply now</button></form>',
    });
    expect((await findApplicationPage(page)).message).toContain(
      'Não encontrei',
    );
    expect(page.url()).toBe('https://example.com/start');
  }, 10_000);

  it('stops navigation loops', async () => {
    const page = await fixture({ '/start': '<a href="/start">Apply now</a>' });
    expect((await findApplicationPage(page)).message).toContain('mesma etapa');
  });

  it('caps the number of application steps', async () => {
    const pages = Object.fromEntries(
      ['/start', '/1', '/2', '/3', '/4', '/5'].map((path, i) => [
        path,
        `<a href="/${i + 1}">Apply now</a>`,
      ]),
    );
    const page = await fixture(pages);
    expect((await findApplicationPage(page)).message).toContain('limite');
    expect(page.url()).toBe('https://example.com/4');
  }, 15_000);

  it('rejects application links to private addresses', async () => {
    const page = await fixture({
      '/start': '<a href="http://127.0.0.1/">Apply now</a>',
    });
    expect((await findApplicationPage(page)).message).toContain(
      'Não encontrei',
    );
    expect(page.url()).toBe('https://example.com/start');
  }, 10_000);

  it('validates redirect destinations and removes the guard after automation', async () => {
    const page = await fixture({ '/start': '' });
    await context.route('https://example.com/redirect', (route) =>
      route.fulfill({
        status: 302,
        headers: { location: 'http://127.0.0.1/' },
      }),
    );
    const remove = await guardApplicationNavigation(context);
    await expect(page.goto('https://example.com/redirect')).rejects.toThrow();
    expect(assertReachable).toHaveBeenCalledWith(new URL('http://127.0.0.1/'));
    await remove();
    await context.route('http://127.0.0.1/**', (route) =>
      route.fulfill({ body: 'manual navigation' }),
    );
    const manual = await context.newPage();
    await manual.goto('http://127.0.0.1/');
    expect(await manual.textContent('body')).toBe('manual navigation');
  });

  it('fills the final embedded application through the service without submitting', async () => {
    await fixture({
      '/start': '<a href="/ats" target="_blank">Apply for this position</a>',
      '/ats':
        '<button type="button" onclick="location.href=\'/application\'">Candidatar-se ao cargo</button>',
      '/application': '<iframe src="/fields"></iframe>',
      '/fields':
        '<form><span>Nome completo *</span><input name="name" placeholder="Nome completo *"><label>Email<input type="email"></label><label>Pretensão salarial *<input name="salary" type="number"></label><label>Resumo de experiência *<textarea name="summary"></textarea></label><label>Carta de apresentação<textarea name="cover_letter"></textarea></label><input type="file" name="resume" hidden><button>Apply now</button></form>',
    });
    const prisma = {
      profile: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Perfil Backend',
          email: 'teste@example.com',
          phone: null,
          location: null,
          links: null,
          resume: null,
          formFillDefaults: {
            fullName: 'Pessoa Teste',
            salaryExpectation: '5000',
            experienceSummary: 'Desenvolvimento de APIs em PHP.',
          },
        }),
      },
    } as unknown as PrismaService;
    const service = new FormFillService(prisma, {
      attachment: jest.fn().mockResolvedValue({
        name: 'curriculo.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n%%EOF'),
      }),
    } as unknown as ResumeFileService);
    Object.defineProperty(service, 'window', {
      value: () => Promise.resolve(context),
    });
    const report = await service.fill(
      'test-profile',
      'https://example.com/start',
    );
    expect(report.url).toBe('https://example.com/application');
    expect(report.submitted).toBe(false);
    expect(report.attachment?.status).toBe('attached');
    expect(report.filled).toEqual(
      expect.arrayContaining([
        { what: 'nome completo', value: 'Pessoa Teste' },
        { what: 'email', value: 'teste@example.com' },
      ]),
    );
    const application = context
      .pages()
      .find((p) => p.url().endsWith('/application'))!;
    expect(
      await application
        .frameLocator('iframe')
        .getByPlaceholder('Nome completo *')
        .inputValue(),
    ).toBe('Pessoa Teste');
    expect(
      await application.frameLocator('iframe').getByLabel('Email').inputValue(),
    ).toBe('teste@example.com');
    expect(
      await application
        .frameLocator('iframe')
        .getByLabel('Pretensão salarial *')
        .inputValue(),
    ).toBe('5000');
    expect(
      await application
        .frameLocator('iframe')
        .getByLabel('Resumo de experiência *')
        .inputValue(),
    ).toBe('Desenvolvimento de APIs em PHP.');
    expect(
      await application
        .frameLocator('iframe')
        .getByLabel('Carta de apresentação')
        .inputValue(),
    ).toBe('');
  }, 20_000);
});
