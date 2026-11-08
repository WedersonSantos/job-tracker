import type { Env } from '../../config/env';

/**
 * Empresas cujo board público é lido a cada rodada da descoberta.
 *
 * Configuração inicial do `.env`; SourceSettingsService dá prioridade à lista
 * salva na tela de fontes. A lista diz em que empresas você tem
 * interesse — isso é seu, não do repositório —, e cada pessoa que clona o
 * projeto monta a dela. Vazia por padrão: Gupy, agregadores remotos, portais
 * brasileiros e os alertas do LinkedIn funcionam sem lista nenhuma.
 *
 * O slug é a parte do endereço do board: `boards.greenhouse.io/<slug>`,
 * `jobs.ashbyhq.com/<slug>`, `jobs.lever.co/<slug>`. Slug errado devolve 404
 * em silêncio e a empresa simplesmente não aparece — confira abrindo o
 * endereço no navegador antes de colocar na lista.
 *
 * Vale evitar boards gigantes: um board de 800 vagas, quase todas presenciais
 * nos EUA, inunda a fila com o oposto do que a ordenação deveria trazer
 * primeiro, e um acima de 4 MB é cortado pelo teto de `safe-fetch.ts`.
 */
export interface Watchlist {
  greenhouse: readonly string[];
  ashby: readonly string[];
  lever: readonly string[];
}

export function watchlistFrom(env: {
  get<K extends keyof Env>(key: K, options: { infer: true }): Env[K];
}): Watchlist {
  return {
    greenhouse: env.get('DISCOVERY_GREENHOUSE_BOARDS', { infer: true }),
    ashby: env.get('DISCOVERY_ASHBY_BOARDS', { infer: true }),
    lever: env.get('DISCOVERY_LEVER_BOARDS', { infer: true }),
  };
}
