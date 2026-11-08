import type { JobSearchResult, JobPreferences } from '@recruit/shared';

/**
 * Uma fonte de vagas.
 *
 * Duas famílias vivem atrás desta mesma interface, e a diferença importa para
 * quem monta a watchlist:
 *
 *   por empresa   Greenhouse, Lever, Ashby — leem o board de uma empresa por
 *                 vez, então exigem lista de slugs. Precisão alta, volume baixo.
 *   por busca     Gupy, RemoteOK, Remotive — respondem a palavra-chave sobre o
 *                 acervo inteiro. Volume alto, sem curadoria.
 *
 * Sozinha, cada família falha no que a outra resolve.
 */
export interface DiscoverySource {
  /** Vai para `JobSearchResult.source` e para a mensagem de falha na tela. */
  readonly name: string;

  /**
   * Prazo próprio, quando o padrão não serve. Fonte que faz uma requisição por
   * vaga precisa de bem mais fôlego que uma que devolve o board inteiro.
   */
  readonly deadlineMs?: number;
  readonly issues?: readonly string[];

  fetch(query: DiscoveryQuery): Promise<JobSearchResult[]>;
}

export function settledJobs(
  results: PromiseSettledResult<JobSearchResult[]>[],
  labels: readonly string[],
  issues: string[],
): JobSearchResult[] {
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    issues.push(
      `${labels[index]}: ${result.reason instanceof Error ? result.reason.message : 'falha na consulta'}`,
    );
    return [];
  });
}

export interface DiscoveryQuery {
  /** Optional profile context for portals with city and modality search fields. */
  profileLocation?: string | null;
  workModels?: JobSearchResult['workModel'][];
  seniorities?: JobPreferences['seniorities'];
  titleIncludes?: string[];
  /** Texto livre. As fontes por busca usam; as por empresa ignoram. */
  q?: string;

  /**
   * Busca ampliada: liga as fontes lentas, que leem portal página a página.
   * Opt-in porque custa segundos, não milissegundos.
   */
  expanded?: boolean;
}

/**
 * Aplica um schema item a item, descartando o que não bate em vez de derrubar
 * a resposta inteira.
 *
 * É a forma prática da regra do §5: JSON de portal é dado externo, e um portal
 * que mude um campo não pode zerar a rodada. O que não valida some, e o
 * chamador registra quantos sumiram.
 */
export function parseEach<T>(
  items: unknown[],
  parse: (item: unknown) => T | null,
): { ok: T[]; dropped: number } {
  const ok: T[] = [];
  let dropped = 0;

  for (const item of items) {
    const parsed = parse(item);

    if (parsed === null) {
      dropped += 1;
      continue;
    }

    ok.push(parsed);
  }

  return { ok, dropped };
}
