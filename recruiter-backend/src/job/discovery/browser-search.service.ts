import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { guardApplicationNavigation } from '../../form-fill/application-navigation';

const PROFILE = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
  'job-tracker',
  'search-browser-profile',
);
export const SEARCH_TIMEOUT_MS = 60_000;
export class SearchAccessChallenge extends Error {}

export function searchFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Falha na pesquisa no navegador.';
  if (/strict mode violation/.test(message))
    return 'O site mudou e há mais de um controle correspondente ao filtro. A integração precisa ser ajustada.';
  if (/Timeout.*exceeded|deadline exceeded/i.test(message))
    return 'O site demorou para carregar os campos ou os resultados da pesquisa.';
  return message;
}

/** A dedicated persistent Chrome session: search tabs never touch application forms. */
@Injectable()
export class BrowserSearchService implements OnModuleDestroy {
  private context: Promise<BrowserContext> | null = null;
  private blockedPages = new Map<string, Page>();
  private window() {
    if (!this.context) {
      this.context = chromium
        .launchPersistentContext(PROFILE, {
          channel: 'chrome',
          headless: false,
          timeout: 15_000,
          viewport: { width: 1280, height: 900 },
          args: ['--no-first-run', '--no-default-browser-check'],
        })
        .then(async (context) => {
          await guardApplicationNavigation(context);
          context.on('close', () => {
            this.context = null;
            this.blockedPages.clear();
          });
          return context;
        })
        .catch((error: unknown) => {
          this.context = null;
          throw error;
        });
    }
    return this.context;
  }
  async run<T>(action: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.window();
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    page.setDefaultNavigationTimeout(25_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keepPage = false;
    try {
      return await Promise.race([
        action(page),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('A pesquisa no navegador excedeu 60 segundos.')),
            SEARCH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof SearchAccessChallenge) {
        keepPage = true;
        const host = new URL(page.url()).hostname;
        await this.blockedPages
          .get(host)
          ?.close()
          .catch(() => {});
        this.blockedPages.set(host, page);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (!keepPage) await page.close().catch(() => {});
    }
  }
  async onModuleDestroy() {
    await this.context?.then((c) => c.close()).catch(() => {});
    this.context = null;
  }
}

export async function openSearchPage(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  if (
    response?.status() === 403 ||
    response?.status() === 429 ||
    /just a moment|access denied|attention required/i.test(title)
  )
    throw new SearchAccessChallenge(
      'O site pediu verificação de acesso. A aba ficou aberta no Chrome de pesquisa para você concluir a verificação e pesquisar novamente.',
    );
  if (response && response.status() >= 400)
    throw new Error(`O site respondeu ${response.status()}.`);
}

/** Wait for client filtering/hydration to settle; always inspect the rendered DOM. */
export async function settleSearch(page: Page) {
  await page
    .waitForLoadState('networkidle', { timeout: 3_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
}
