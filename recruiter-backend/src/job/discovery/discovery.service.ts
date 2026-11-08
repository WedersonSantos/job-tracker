import { Injectable, Logger } from '@nestjs/common';
import { SourceSettingsService } from './source-settings.service';
import type {
  DiscoverResult,
  JobPreferences,
  JobSearchResult,
  SourceDiagnostic,
  SourceOverview,
  SourceSettings,
} from '@recruit/shared';
import { BrazilPortalsSource } from './sources/br-portals';
import { GreenhouseSource } from './sources/greenhouse';
import { GupySource } from './sources/gupy';
import { PrismaService } from '../../prisma/prisma.service';
import { LinkedInAlertsSource } from './sources/linkedin-alerts';
import { RemoteOkSource, RemotiveSource } from './sources/remote-boards';
import { matches, matchesTerm } from './filters';
import { fold } from './normalize';
import { workModelEvidence } from './work-model-evidence';
import type { DiscoveryQuery, DiscoverySource } from './provider';
import { scoreJob, sortKey } from './scoring';
import { BrowserSearchService } from './browser-search.service';
import { JobAvailabilityChecker } from './job-availability';
import {
  BrowserPortalSource,
  BrowserBoardSource,
} from './sources/browser-sources';

/**
 * Junta as fontes, filtra, ordena e fatia.
 *
 * Cada pesquisa nova consulta APIs e navega nos portais novamente. O lote
 * fica em cache por 15 minutos somente para paginar a mesma pesquisa.
 */

/**
 * Quarenta, e não vinte: a tela mostra até quatro por linha, então vinte vagas
 * são cinco linhas — você chegaria ao fim da lista a cada dois gestos de
 * rolagem. Fatiar mais custa zero, porque o acervo inteiro já está em memória
 * depois da primeira busca.
 */
const BATCH_SIZE = 40;

/** Vagas mudam em dias, não em minutos. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Uma fonte lenta não pode segurar o lote inteiro. */
const SOURCE_DEADLINE_MS = 15_000;

interface CacheEntry {
  at: number;
  items: JobSearchResult[];
  failed: string[];
}

interface Collected extends Omit<CacheEntry, 'at'> {
  /** Tempo de rede desta chamada. Zero quando veio do cache. */
  fetchMs: number;
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly availability = new JobAvailabilityChecker((url, timeoutMs) =>
    this.browser.run(async (page) => {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.waitForTimeout(300);
      return { html: await page.content(), finalUrl: page.url() };
    }),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SourceSettingsService,
    private readonly browser: BrowserSearchService = new BrowserSearchService(),
  ) {}

  private sources(watchlist: SourceSettings): DiscoverySource[] {
    return [
      new GupySource(),
      new GreenhouseSource(watchlist.greenhouse),
      new BrowserBoardSource('ashby', watchlist.ashby, this.browser),
      new BrowserBoardSource('lever', watchlist.lever, this.browser),
      new BrowserPortalSource('solutis-inhire', this.browser),
      new BrowserPortalSource('jobbol', this.browser),
      new RemoteOkSource(),
      new RemotiveSource(),
      new BrazilPortalsSource(),
      new BrowserPortalSource('uberlandia-inovadora', this.browser),
      // Por último: a ordem do array é prioridade de deduplicação, e o alerta
      // é o registro mais pobre de qualquer vaga que ele compartilhe — não
      // traz descrição. Se a mesma vaga vier do Greenhouse, a versão rica vence.
      new LinkedInAlertsSource(this.prisma),
    ];
  }

  private readonly cache = new Map<string, CacheEntry>();
  private lastRun: {
    at: string;
    settingsKey: string;
    sources: SourceDiagnostic[];
  } | null = null;

  invalidate() {
    this.cache.clear();
    this.availability.clear();
    this.lastRun = null;
  }

  async overview(): Promise<SourceOverview> {
    const settings = await this.settings.read();
    const email = this.settings.emailSetup();
    const last =
      this.lastRun?.settingsKey === JSON.stringify(settings)
        ? this.lastRun
        : null;
    const sources =
      last?.sources ??
      this.sources(settings).map((source) => {
        const missing =
          (!email.configured && source.name === 'linkedin-alerts') ||
          (['greenhouse', 'ashby', 'lever'].includes(source.name) &&
            !settings[source.name as keyof SourceSettings].length);
        return {
          name: source.name,
          status: missing
            ? ('not-configured' as const)
            : ('not-tested' as const),
          count: 0,
          message: missing
            ? source.name === 'linkedin-alerts'
              ? 'Configure o email para receber alertas do LinkedIn.'
              : 'Adicione murais de empresas para ativar esta fonte.'
            : 'Ainda não testada nesta sessão.',
        };
      });
    return { settings, email, sources, checkedAt: last?.at ?? null };
  }

  async check(): Promise<SourceOverview> {
    await this.collect('python', true, true);
    return this.overview();
  }

  async discover(params: {
    q?: string;
    expanded?: boolean;
    skills: string[];
    profileLocation?: string | null;
    preferences: JobPreferences;
    excludedUrls: Set<string>;
    cursor?: string;
  }): Promise<DiscoverResult> {
    const { items, failed, fetchMs } = await this.collect(
      params.q,
      params.expanded,
      !params.cursor,
      {
        profileLocation: params.profileLocation,
        workModels: params.preferences.workModels,
        seniorities: params.preferences.seniorities,
        titleIncludes: params.preferences.titleIncludes,
      },
    );

    const eligible = items
      .map((job) => ({ ...job, workModel: workModelEvidence(job).model }))
      .filter((job) =>
        matches(job, params.preferences, new Date(), params.profileLocation),
      )
      .filter((job) => matchesTerm(job, params.q));

    const ranked = eligible
      .map((job) => ({
        job,
        key: sortKey(job, scoreJob(job, params.skills, params.preferences)),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    const unseen = ranked.filter(
      ({ job }) => !params.excludedUrls.has(job.url),
    );

    // Chave ordenável, e não deslocamento: o usuário descarta vagas entre uma
    // requisição e a seguinte, o conjunto encolhe, e um deslocamento numérico
    // pularia em silêncio tantas vagas quantas foram removidas.
    const after = params.cursor
      ? unseen.filter(({ key }) => key > params.cursor!)
      : unseen;

    const validationStarted = Date.now();
    const deadline = validationStarted + 20_000;
    const page: typeof after = [];
    let offset = 0;
    // Check only the results about to be displayed, replenishing expired slots.
    // The deadline bounds latency even when every portal is unavailable.
    while (page.length < BATCH_SIZE && offset < after.length) {
      const batch = after.slice(
        offset,
        offset + Math.min(8, BATCH_SIZE - page.length),
      );
      offset += batch.length;
      const checked = await Promise.allSettled(
        batch.map(({ job }) => this.availability.check(job.url, deadline)),
      );
      checked.forEach((outcome, index) => {
        const entry = batch[index];
        const value =
          outcome.status === 'fulfilled'
            ? outcome.value
            : {
                state: 'unknown' as const,
                checkedAt: new Date().toISOString(),
                reason: 'Não foi possível verificar a disponibilidade.',
              };
        if (value.state !== 'inactive')
          page.push({
            ...entry,
            job: {
              ...entry.job,
              availability: { ...value, state: value.state },
            },
          });
      });
    }
    const last = page.at(-1);
    const availableCount = eligible.filter(
      (job) => !this.availability.isInactive(job.url),
    ).length;

    return {
      items: page.map(({ job }) => job),
      nextCursor: offset < after.length && last ? last.key : null,
      total: availableCount,
      exhausted:
        page.length > 0 ? null : availableCount > 0 ? 'nada-novo' : 'fim',
      failedSources: failed,
      fetchMs: fetchMs + Date.now() - validationStarted,
    };
  }

  /**
   * Busca em todas as fontes, com cache por termo.
   *
   * `Promise.allSettled` com prazo por fonte: um board fora do ar ou lento vira
   * um nome na lista de falhas, e a tela mostra que a cobertura foi parcial em
   * vez de fingir que o acervo é aquele.
   */
  private async collect(
    q?: string,
    expanded?: boolean,
    force = false,
    context: Omit<DiscoveryQuery, 'q' | 'expanded'> = {},
  ): Promise<Collected> {
    const settings = await this.settings.read();
    const sources = this.sources(settings);
    // A flag entra na chave: sem isso, marcar "ampliar" devolveria o resultado
    // estreito que já estava em memória.
    const key = `${JSON.stringify(settings)}:${JSON.stringify(context)}:${expanded ? '+' : '-'}${fold(q ?? '')}`;
    const cached = this.cache.get(key);

    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { items: cached.items, failed: cached.failed, fetchMs: 0 };
    }

    const started = Date.now();

    const settled = await Promise.allSettled(
      sources.map((source) =>
        withDeadline(source, { q, expanded, ...context }),
      ),
    );

    const items: JobSearchResult[] = [];
    const failed: string[] = [];
    const byUrl = new Set<string>();
    const diagnostics: SourceDiagnostic[] = [];
    const email = this.settings.emailSetup();

    settled.forEach((outcome, index) => {
      const source = sources[index];

      if (outcome.status === 'rejected') {
        failed.push(source.name);
        diagnostics.push({
          name: source.name,
          status: 'error',
          count: 0,
          message: describe(outcome.reason),
        });
        this.logger.warn(
          `Fonte ${source.name} falhou: ${describe(outcome.reason)}`,
        );

        return;
      }

      const issues = [...new Set(source.issues ?? [])];
      const unconfigured =
        (source.name === 'linkedin-alerts' &&
          !email.configured &&
          !outcome.value.length) ||
        (['greenhouse', 'ashby', 'lever'].includes(source.name) &&
          !settings[source.name as keyof SourceSettings].length);
      const status: SourceDiagnostic['status'] = unconfigured
        ? 'not-configured'
        : source.name === 'portais-br' && !expanded
          ? 'disabled'
          : issues.length
            ? outcome.value.length
              ? 'partial'
              : 'error'
            : outcome.value.length
              ? 'ok'
              : 'empty';
      if (issues.length) failed.push(source.name);
      diagnostics.push({
        name: source.name,
        status,
        count: outcome.value.length,
        message: issues.length
          ? issues.join(' · ')
          : unconfigured
            ? source.name === 'linkedin-alerts'
              ? 'Configure o email para receber alertas do LinkedIn.'
              : 'Adicione murais de empresas para ativar esta fonte.'
            : status === 'disabled'
              ? 'Ative a busca ampliada para consultar estes portais.'
              : outcome.value.length
                ? 'Consulta concluída.'
                : 'Consulta concluída sem vagas nesta rodada.',
      });

      for (const job of outcome.value) {
        // A mesma vaga aparece em mais de uma fonte — o RemoteOK republica
        // anúncio que também está no board da empresa.
        if (byUrl.has(job.url)) {
          continue;
        }

        byUrl.add(job.url);
        items.push(job);
      }
    });

    this.logger.log(
      `Descoberta: ${items.length} vagas; ${failed.length} fontes com falhas em ${Date.now() - started}ms`,
    );

    const fetchMs = Date.now() - started;

    this.cache.set(key, { at: Date.now(), items, failed });
    this.lastRun = {
      at: new Date().toISOString(),
      settingsKey: JSON.stringify(settings),
      sources: diagnostics,
    };

    return { items, failed, fetchMs };
  }
}

async function withDeadline(
  source: DiscoverySource,
  query: DiscoveryQuery,
): Promise<JobSearchResult[]> {
  const limit = source.deadlineMs ?? SOURCE_DEADLINE_MS;

  return Promise.race([
    source.fetch(query),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`prazo de ${limit}ms estourado`)),
        limit,
      ).unref(),
    ),
  ]);
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
