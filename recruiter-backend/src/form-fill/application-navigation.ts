import type { BrowserContext, Frame, Page, Route } from 'playwright-core';
import { assertReachable } from '../job/safe-fetch';
import { locateInFrame } from './field-locator';
import { FULL_NAME_LABEL, FIRST_NAME_LABEL } from './field-plan';
import { resumeButtons, resumeInputs } from './resume-upload';

const GOOGLE =
  /^(?:entrar|continuar|acessar|cadastrar(?:-se)?)(?: (?:com|usando)) (?:o )?google$|^(?:sign in|log in|continue|sign up) with google$/i;
export { GOOGLE as GOOGLE_LOGIN_LABEL };

const APPLY =
  /^(apply( now| here| for (this |the )?(position|job)| to (this |the )?(position|job)| on (the )?(company|employer)(['’]s)? (site|website))?|candidate-se( a (esta |essa |uma )?vaga| no site da empresa)?|candidatar-se( (ao cargo|[àa] vaga|para a vaga)| no site da empresa)?|candidatar|quero me candidatar|responder agora|%BUTTON_APPLY_TO_POSITION%)\s*[!→»]?$/i;
export { APPLY as APPLICATION_ACTION_LABEL };
const MAX_STEPS = 4;

export interface ApplicationPage {
  page: Page;
  message?: string;
}

/** Covers redirects and popups too, while the automated navigation is running. */
export async function guardApplicationNavigation(context: BrowserContext) {
  const guard = async (route: Route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    try {
      if (route.request().method() !== 'GET')
        throw new Error('navigation method');
      await assertReachable(new URL(route.request().url()));
      await route.fallback();
    } catch {
      await route.abort('blockedbyclient');
    }
  };
  await context.route('**/*', guard);
  return () => context.unroute('**/*', guard);
}

/** Only opens the application. Never clicks a control inside a form. */
export async function findApplicationPage(
  initial: Page,
): Promise<ApplicationPage> {
  let page = initial;
  const visited = new Set<string>();

  for (let step = 0; step <= MAX_STEPS; step++) {
    await page
      .waitForLoadState('domcontentloaded', { timeout: 15_000 })
      .catch(() => {});
    const until = Date.now() + 6_000;
    let action: Awaited<ReturnType<typeof applicationLink>> = null;

    // ATS pages may render their form or application button after hydration.
    do {
      if (new URL(page.url()).hostname === 'accounts.google.com')
        return {
          page,
          message:
            'Conclua a entrada com o Google nesta janela. Depois, tente o preenchimento novamente; a sessão ficará salva.',
        };
      action = await applicationLink(page, true);
      if (action) break;
      if (await visible(page, 'input[type="password"]')) {
        return {
          page,
          message:
            'Faça login na janela do Chrome e tente novamente após acessar o formulário.',
        };
      }
      if (
        await visible(
          page,
          '#challenge-running, #challenge-stage, iframe[title*="challenge" i], input[name*="captcha" i]',
        )
      ) {
        return {
          page,
          message: 'Resolva a verificação CAPTCHA no Chrome e tente novamente.',
        };
      }
      if (await hasApplicationFields(page)) return { page };
      action = await applicationLink(page);
      if (action) break;
      await page.waitForTimeout(250);
    } while (Date.now() < until);

    if (!action) {
      return {
        page,
        message:
          'Não encontrei o formulário nem um botão de candidatura seguro. Abra o formulário no Chrome para continuar manualmente.',
      };
    }
    if (step === MAX_STEPS) {
      return {
        page,
        message:
          'O caminho até o formulário atingiu o limite de etapas. Continue manualmente no Chrome.',
      };
    }
    const key = `${page.url()}|${action.key}`;
    if (visited.has(key)) {
      return {
        page,
        message:
          'O botão de candidatura voltou à mesma etapa. Continue manualmente no Chrome.',
      };
    }
    visited.add(key);

    // Register before clicking: target=_blank and window.open must both work.
    const popup = page
      .waitForEvent('popup', { timeout: 1_500 })
      .catch(() => null);
    try {
      await action.locator.click({ timeout: 5_000 });
    } catch {
      await popup;
      return {
        page,
        message:
          'Não consegui abrir a próxima etapa. Continue manualmente no Chrome.',
      };
    }
    page = (await popup) ?? page;
  }
  return { page };
}

async function visible(page: Page, selector: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const item of await frame.locator(selector).all()) {
      if (await item.isVisible()) return true;
    }
  }
  return false;
}

async function hasApplicationFields(page: Page): Promise<boolean> {
  if ((await resumeInputs(page)).length || (await resumeButtons(page)).length)
    return true;
  for (const frame of page.frames()) {
    // Email alone is often a newsletter. Require name + email, or a CV upload.
    for (const upload of await frame.locator('input[type="file"]').all()) {
      if (await upload.isVisible()) return true;
    }
    const name =
      (await locateInFrame(frame, {
        what: 'nome completo',
        value: '',
        labels: FULL_NAME_LABEL,
        names: /^(name|full[_-]?name|nome_completo)$/i,
        autocomplete: 'name',
      })) ??
      (await locateInFrame(frame, {
        what: 'primeiro nome',
        value: '',
        labels: FIRST_NAME_LABEL,
        names: /^(first[_-]?name)$/i,
        autocomplete: 'given-name',
      }));
    const email = frame
      .locator('input[type="email"]')
      .or(frame.getByRole('textbox', { name: /^e-?mail( address)?\s*\*?$/i }));
    if (name && (await anyEditable(email))) return true;
  }
  return false;
}

async function anyEditable(locator: ReturnType<Frame['locator']>) {
  for (const item of await locator.all()) {
    if ((await item.isVisible()) && (await item.isEditable())) return true;
  }
  return false;
}

async function applicationLink(page: Page, google = false) {
  for (const frame of page.frames()) {
    const candidates = frame
      .getByRole('link', { name: google ? GOOGLE : APPLY })
      .or(frame.getByRole('button', { name: google ? GOOGLE : APPLY }));
    for (const locator of await candidates.all()) {
      if (!(await locator.isVisible()) || !(await locator.isEnabled()))
        continue;
      const info = await locator.evaluate((element) => ({
        inForm:
          Boolean(element.closest('form')) ||
          element.hasAttribute('form') ||
          element.hasAttribute('formaction'),
        type: element.getAttribute('type'),
        href: element.getAttribute('href'),
        text: element.textContent?.trim() ?? '',
      }));
      if (
        (!google && info.inForm) ||
        info.type === 'submit' ||
        info.type === 'image'
      )
        continue;
      if (info.href && !info.href.startsWith('#')) {
        try {
          await assertReachable(new URL(info.href, frame.url()));
        } catch {
          continue;
        }
      }
      return { locator, key: `${frame.url()}|${info.href}|${info.text}` };
    }
  }
  return null;
}
