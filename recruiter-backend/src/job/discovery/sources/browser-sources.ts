import type { JobSearchResult, WorkModel } from '@recruit/shared';
import { ashbyBoardReference, leverBoardReference } from '@recruit/shared';
import type { Page, Locator } from 'playwright-core';
import {
  BrowserSearchService,
  openSearchPage,
  settleSearch,
  searchFailure,
} from '../browser-search.service';
import type { DiscoveryQuery, DiscoverySource } from '../provider';
import { portalSearchLocation } from '../location-eligibility';
import { fold } from '../normalize';
import { canonicalJobUrl } from '../canonical-url';
import { parseJobbolJobs } from './jobbol';
import { parseUberlandiaJobs } from './uberlandia-inovadora';
import { parseSolutisJobs } from './solutis-inhire';
import { AshbySource } from './ashby';
import { LeverSource } from './lever';

const MODEL: Record<WorkModel, string> = {
  remoto: 'Remoto',
  hibrido: 'Híbrido',
  presencial: 'Presencial',
};
const MAX_PAGES = 5;
const singleModel = (q: DiscoveryQuery) =>
  q.workModels?.length === 1 ? q.workModels[0] : null;

function unique(items: JobSearchResult[]) {
  return [...new Map(items.map((j) => [j.url, j])).values()];
}
async function clickIfPresent(locator: Locator) {
  if ((await locator.count()) && (await locator.first().isVisible())) {
    await locator.first().click();
    return true;
  }
  return false;
}
async function visibleUrls(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => (n as HTMLElement).getClientRects().length)
        .map((n) => (n as HTMLAnchorElement).href),
    );
}

export class BrowserPortalSource implements DiscoverySource {
  readonly deadlineMs = 75_000;
  readonly issues: string[] = [];
  constructor(
    readonly name: 'jobbol' | 'solutis-inhire' | 'uberlandia-inovadora',
    private readonly browser: BrowserSearchService,
  ) {}
  async fetch(query: DiscoveryQuery): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const models = [
      ...new Set(
        query.workModels?.filter((m): m is WorkModel => m !== null) ?? [],
      ),
    ];
    const queries =
      this.name !== 'uberlandia-inovadora' && models.length > 1
        ? models.map((model) => ({ ...query, workModels: [model] }))
        : [query];
    const results = await Promise.allSettled(
      queries.map((q) =>
        this.browser.run((page) =>
          this.name === 'jobbol'
            ? this.jobbol(page, q)
            : this.name === 'solutis-inhire'
              ? this.solutis(page, q)
              : this.uberlandia(page, q),
        ),
      ),
    );
    const jobs: JobSearchResult[] = [];
    let completed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        jobs.push(...result.value);
        completed++;
      } else this.issues.push(`${this.name}: ${searchFailure(result.reason)}`);
    }
    if (!completed) throw new Error(this.issues.join(' · '));
    return unique(jobs);
  }
  private async jobbol(page: Page, q: DiscoveryQuery) {
    await openSearchPage(page, 'https://www.jobbol.com.br/buscar-vagas');
    await settleSearch(page);
    await clickIfPresent(
      page.getByRole('button', { name: 'Recusar opcionais', exact: true }),
    );
    await page
      .locator('#cargo')
      .fill(q.q?.trim() || q.titleIncludes?.[0] || 'desenvolvedor');
    const local = portalSearchLocation(q.profileLocation);
    const national =
      singleModel(q) === 'remoto' || !singleModel(q) || !local.city;
    // The portal's visible city picker writes hidden city/UF fields itself.
    await page.locator('#local').fill(national ? 'Brasil' : local.city!);
    await page
      .locator('#lista-cidades li')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {});
    const options = page.locator('#lista-cidades li');
    let chosen = false;
    for (const option of national ? [] : await options.all()) {
      const label = fold(await option.innerText());
      if (
        local.city &&
        label.includes(fold(local.city)) &&
        (!local.state || label.includes(fold(local.state)))
      ) {
        await option.click();
        chosen = true;
        break;
      }
    }
    if (national) {
      // Typing clears the portal's hidden city/UF fields; do not pick Brasília
      // merely because it matches "Brasil" in the autocomplete.
      if (
        (await page.locator('#cidade').inputValue()) ||
        (await page.locator('#estado').inputValue())
      )
        throw new Error(
          'Jobbol: a pesquisa remota continuou restrita a uma cidade.',
        );
      await page.locator('#cargo').click();
      chosen = true;
    }
    if (!chosen)
      throw new Error(
        'Jobbol: não foi possível selecionar a localização na lista do site; nenhum endereço padrão foi usado.',
      );
    await Promise.all([
      page.waitForURL(/\/busca\?/),
      page.getByRole('button', { name: 'BUSCAR', exact: true }).click(),
    ]);
    const model = singleModel(q);
    if (model === 'remoto' || model === 'hibrido') {
      await page
        .locator('#regime')
        .selectOption(model === 'remoto' ? 'Home Office' : 'Hibrid');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.getByRole('button', { name: /FILTRAR/ }).click(),
      ]);
    }
    const result: JobSearchResult[] = [];
    for (let i = 1; i <= MAX_PAGES; i++) {
      await page.waitForFunction(
        () =>
          !!document.querySelector('#lista-vagas .card-vaga') ||
          /Nenhuma vaga encontrada/i.test(document.body.innerText),
      );
      // Cards are inserted one at a time by the site. Wait until their count stabilizes.
      let previous = -1;
      for (let tick = 0; tick < 30; tick++) {
        const count = await page.locator('#lista-vagas .card-vaga').count();
        if (count === previous) break;
        previous = count;
        await page.waitForTimeout(400);
      }
      const parsed = parseJobbolJobs(await page.content());
      if (!parsed.recognized)
        throw new Error('Jobbol: resultado da pesquisa não reconhecido.');
      result.push(
        ...parsed.items.map((j) => ({
          ...j,
          workModel:
            j.workModel ??
            (model === 'remoto' || model === 'hibrido' ? model : null),
        })),
      );
      if (parsed.invalid)
        this.issues.push(`${parsed.invalid} anúncios incompletos.`);
      const next = page
        .locator(`a[href*="pagina=${i + 1}"]`)
        .filter({ visible: true })
        .first();
      if (!(await next.count())) break;
      if (i === MAX_PAGES) {
        this.issues.push('Jobbol: limite de cinco páginas por pesquisa.');
        break;
      }
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        next.click(),
      ]);
    }
    return unique(result);
  }
  private async solutis(page: Page, q: DiscoveryQuery) {
    const payload = page
      .waitForResponse(
        (r) =>
          r.url().startsWith('https://api.inhire.app/job-posts/public/pages') &&
          r.ok(),
        { timeout: 25_000 },
      )
      .then((r) => r.json() as Promise<unknown>);
    // Attach rejection handling immediately if navigation fails.
    void payload.catch(() => {});
    await openSearchPage(page, 'https://solutis.inhire.app/vagas/');
    await page.locator('#name').waitFor({ state: 'visible', timeout: 25_000 });
    await settleSearch(page);
    if (q.q?.trim()) await page.locator('#name').fill(q.q.trim());
    const model = singleModel(q);
    if (model) {
      await page.locator('[aria-label="Dropdown select"]').nth(0).click();
      await page
        .getByRole('option', { name: MODEL[model], exact: true })
        .click();
    }
    const local = portalSearchLocation(q.profileLocation);
    if (model && model !== 'remoto' && local.city) {
      await page.locator('[aria-label="Dropdown select"]').nth(1).click();
      const options = page.getByRole('option');
      const available = await options.allTextContents();
      const index = available.findIndex(
        (t) =>
          fold(t).includes(fold(local.city!)) &&
          (!local.state || fold(t).includes(fold(local.state))),
      );
      if (index >= 0) await options.nth(index).click();
      else {
        await page.locator('#name').click();
        this.issues.push(
          'A cidade cadastrada não está nas opções do Solutis; o filtro local do programa foi aplicado.',
        );
      }
    }
    await settleSearch(page);
    let previous = -1;
    for (let i = 0; i < 15; i++) {
      const links = page.locator('a[data-component-name="job-position-link"]');
      const count = await links.count();
      if (count === previous || !count) break;
      previous = count;
      await links.last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
    const urls = new Set(
      await visibleUrls(page, 'a[data-component-name="job-position-link"]'),
    );
    // Metadata comes from the response loaded by this very browser visit, not a second search.
    const parsed = parseSolutisJobs(await payload);
    const ids = new Set(
      [...urls].map((u) => new URL(u).pathname.split('/')[2]),
    );
    if (parsed.invalid)
      this.issues.push(`${parsed.invalid} anúncios incompletos.`);
    return parsed.items.filter((j) =>
      ids.has(new URL(j.url).pathname.split('/')[2]),
    );
  }
  private async uberlandia(page: Page, q: DiscoveryQuery) {
    await openSearchPage(page, 'https://uberlandiainovadora.com.br/vagas');
    await page.waitForLoadState('load', { timeout: 15_000 });
    await settleSearch(page);
    const type = page.getByRole('button', { name: /🦜\s*Vaga/ });
    await type.waitFor({ state: 'visible' });
    if (!(await type.getAttribute('class'))?.includes('bg-primary '))
      await type.click();
    const search = page.getByPlaceholder('Buscar por cargo, empresa ou stack', {
      exact: false,
    });
    if (q.q?.trim()) await search.fill(q.q.trim());
    const levels: Record<string, RegExp[]> = {
      junior: [/^Entrada ·/],
      pleno: [/^Pleno/],
      senior: [/^Sênior/, /^Especialista/],
      lead: [/^Liderança/],
      staff: [/^Especialista/],
    };
    const selected = new Set<string>();
    for (const level of q.seniorities ?? [])
      for (const label of levels[level] ?? []) {
        if (selected.has(label.source)) continue;
        selected.add(label.source);
        await page
          .getByRole('button', { name: label })
          .and(page.locator('button:not([aria-pressed])'))
          .first()
          .click();
      }
    // The program retains unknown seniority, so preserve those cards too.
    if (selected.size)
      await clickIfPresent(
        page.getByRole('button', { name: /^Não informado/ }),
      );
    await settleSearch(page);
    const html = await page.content();
    if (!(await page.locator('a.bg-card h3.line-clamp-2').count())) {
      if (
        /0\s+oportunidades|nenhuma.*(?:vaga|oportunidade)/i.test(
          await page.locator('body').innerText(),
        )
      )
        return [];
      throw new Error(
        'Uberlândia Inovadora: resultado filtrado não reconhecido.',
      );
    }
    const parsed = parseUberlandiaJobs(html);
    const visible = new Set(
      (await visibleUrls(page, 'a.bg-card')).map(canonicalJobUrl),
    );
    if (parsed.withoutWebLink)
      this.issues.push(
        `${parsed.withoutWebLink} anúncios apenas com email ou sem link web.`,
      );
    return parsed.items.filter((j) => visible.has(j.url));
  }
}

/** Configured ATS boards use their visible filters and collect only displayed postings. */
export class BrowserBoardSource implements DiscoverySource {
  readonly deadlineMs = 75_000;
  readonly issues: string[] = [];
  constructor(
    readonly name: 'ashby' | 'lever',
    private readonly boards: readonly string[],
    private readonly browser: BrowserSearchService,
  ) {}
  async fetch(q: DiscoveryQuery) {
    this.issues.length = 0;
    const found: JobSearchResult[] = [];
    for (const board of this.boards) {
      try {
        const jobs = await this.browser.run(async (page) => {
          const ref =
            this.name === 'ashby'
              ? ashbyBoardReference(board)
              : leverBoardReference(board);
          await openSearchPage(
            page,
            `https://${this.name === 'ashby' ? 'jobs.ashbyhq.com' : 'jobs.lever.co'}/${ref.slug}`,
          );
          if (this.name === 'ashby') {
            await page
              .getByRole('combobox', { name: 'Department', exact: true })
              .waitFor({ state: 'visible', timeout: 25_000 });
            const department = ashbyBoardReference(board).departmentId;
            if (department)
              await page
                .getByRole('combobox', { name: 'Department', exact: true })
                .selectOption(department);
            const model = singleModel(q);
            if (model) {
              const filter = page.getByRole('combobox', {
                name: 'Location Type',
                exact: true,
              });
              const options = await filter.locator('option').evaluateAll((es) =>
                es.map((e) => ({
                  value: (e as HTMLOptionElement).value,
                  text: e.textContent ?? '',
                })),
              );
              const option = options.find((o) =>
                new RegExp(
                  model === 'remoto'
                    ? 'Remote'
                    : model === 'hibrido'
                      ? 'Hybrid'
                      : 'On.?site',
                  'i',
                ).test(o.text),
              );
              if (option) await filter.selectOption(option.value);
              else
                this.issues.push(
                  `${ref.slug}: modalidade não disponível no site; filtro aplicado no programa.`,
                );
            }
          } else {
            await page
              .getByRole('button', { name: /Filter by Team:/ })
              .waitFor({ state: 'visible', timeout: 25_000 });
            const team = leverBoardReference(board).team;
            if (team) {
              await page
                .getByRole('button', { name: /Filter by Team:/ })
                .click();
              await page.getByRole('link', { name: team, exact: true }).click();
              await settleSearch(page);
            }
            const model = singleModel(q);
            if (model) {
              await page
                .getByRole('button', { name: /Filter by Location type:/ })
                .click();
              await page.waitForTimeout(200);
              const option = page.getByRole('link', {
                name: new RegExp(
                  `^${model === 'remoto' ? 'Remote' : model === 'hibrido' ? 'Hybrid' : 'On.?site'}\\b`,
                  'i',
                ),
              });
              if (await option.count())
                await option.filter({ visible: true }).first().click();
              else {
                await page
                  .getByRole('button', { name: /Filter by Location type:/ })
                  .click();
                this.issues.push(
                  `${ref.slug}: modalidade não disponível no site; filtro aplicado no programa.`,
                );
              }
            }
          }
          const local = portalSearchLocation(q.profileLocation);
          if (singleModel(q) && singleModel(q) !== 'remoto' && local.city) {
            if (this.name === 'ashby') {
              const filter = page.getByRole('combobox', {
                name: 'Location',
                exact: true,
              });
              const options = await filter.locator('option').evaluateAll((es) =>
                es.map((e) => ({
                  value: (e as HTMLOptionElement).value,
                  text: e.textContent ?? '',
                })),
              );
              const option = options.find((o) =>
                fold(o.text).includes(fold(local.city!)),
              );
              if (option) await filter.selectOption(option.value);
              else
                this.issues.push(
                  `${ref.slug}: cidade não disponível no site; filtro aplicado no programa.`,
                );
            } else {
              const filter = page.getByRole('button', {
                name: /Filter by Location:/,
              });
              await filter.click();
              const options = page.getByRole('link').filter({ visible: true });
              const labels = await options.allTextContents();
              const index = labels.findIndex((t) =>
                fold(t).includes(fold(local.city!)),
              );
              if (index >= 0) await options.nth(index).click();
              else {
                await filter.click();
                this.issues.push(
                  `${ref.slug}: cidade não disponível no site; filtro aplicado no programa.`,
                );
              }
            }
          }
          await settleSearch(page);
          const urls = new Set(
            (await visibleUrls(page, `a[href*="/${ref.slug}/"]`)).map((u) =>
              u.split('?')[0].replace(/\/$/, ''),
            ),
          );
          const delegate =
            this.name === 'ashby'
              ? new AshbySource([board])
              : new LeverSource([board]);
          const enriched = await delegate.fetch();
          this.issues.push(...delegate.issues);
          return enriched.filter((j) =>
            urls.has(j.url.split('?')[0].replace(/\/$/, '')),
          );
        });
        found.push(...jobs);
      } catch (error) {
        this.issues.push(`${board}: ${searchFailure(error)}`);
      }
    }
    return unique(found);
  }
}
