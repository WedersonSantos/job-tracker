"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Exhaustion, JobPreferences } from "@recruit/shared";
import { discoverAction } from "@/features/jobs/actions";
import { ExtractCard } from "@/features/jobs/components/extract-card";
import {
  FiltersModal,
  countMarked,
} from "@/features/jobs/components/filters-modal";
import { JobsTabs } from "@/features/jobs/components/jobs-tabs";
import {
  ResultCard,
  type SearchResultItem,
} from "@/features/jobs/components/result-card";
import { SearchTimer, format } from "@/features/jobs/components/search-timer";
import type { JobSearchResult } from "@/features/jobs/types";
import { saveProfileAction } from "@/features/profile/actions";

/**
 * A busca em estilo fila de partida: liga, e as vagas vão chegando.
 *
 * O ritmo NÃO vem de relógio. Medido, buscar em todas as fontes leva ~3s na
 * primeira vez e sai da memória depois — um laço por tempo despejaria as 800
 * vagas em segundos. Então o próximo lote é pedido quando você chega perto do
 * fim da lista: quem dita o ritmo é a triagem, não um timer.
 */

interface JobDiscoveryProps {
  profileId: string;
  query: string;
  preferences: JobPreferences;
  savedUrls: string[];
  savedCount: number;
}

/** Trava contra laço infinito se o cursor parar de avançar por um defeito. */
const MAX_BATCHES = 25;

interface RunStats {
  batches: number;
  fetchMs: number;
  elapsedMs: number;
}

export function JobDiscovery({
  profileId,
  query,
  preferences,
  savedUrls,
  savedCount,
}: JobDiscoveryProps) {
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [exhausted, setExhausted] = useState<Exhaustion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [demand, setDemand] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastRun, setLastRun] = useState<RunStats | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState(preferences);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savingFilters, setSavingFilters] = useState(false);

  // Cursor em ref, não em state: ele muda a cada lote, e como state entraria
  // nas dependências do efeito e dispararia o lote seguinte sozinho — o
  // despejo que a pausa por rolagem existe para evitar.
  const cursor = useRef<string | null>(null);
  const batches = useRef(0);
  const fetchMs = useRef(0);
  const began = useRef<number | null>(null);
  const runId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const saved = useRef(new Set(savedUrls));

  // Derivado, e não um state próprio: chamar setState dentro do efeito dispara
  // render em cascata (react-hooks/set-state-in-effect). Um lote está em voo
  // enquanto houver mais pedidos do que lotes concluídos.
  const pending = running && demand > completed;

  const askForMore = useCallback(() => setDemand((value) => value + 1), []);

  /** Para e registra a corrida — o cronômetro zera, o número sobrevive. */
  const stop = useCallback(() => {
    setRunning(false);
    setStartedAt(null);

    if (began.current !== null) {
      setLastRun({
        batches: batches.current,
        fetchMs: fetchMs.current,
        elapsedMs: Date.now() - began.current,
      });
      began.current = null;
    }
  }, []);

  const start = useCallback(() => {
    // A new search must not mix a previous profile/city or keep its cursor.
    runId.current += 1;
    cursor.current = null;
    setItems([]);
    setTotal(null);
    setFailed([]);
    setCompleted(0);
    setDemand(1);
    setError(null);
    setExhausted(null);
    setRunning(true);
    began.current = Date.now();
    setStartedAt(began.current);
    batches.current = 0;
    fetchMs.current = 0;
  }, []);

  /** Critério novo, ordem nova: a lista acumulada não vale mais. */
  const applyFilters = (next: JobPreferences) => {
    setSavingFilters(true);

    void (async () => {
      const outcome = await saveProfileAction(profileId, { preferences: next });

      setSavingFilters(false);

      if (outcome.status === "error") {
        setError(outcome.message);

        return;
      }

      setFilters(next);
      setFiltersOpen(false);
      setItems([]);
      setTotal(null);
      cursor.current = null;
      start();
    })();
  };

  // Busca um lote. `runId` é o que sobrevive ao efeito duplo do StrictMode em
  // desenvolvimento: sem ele, o primeiro clique dispara dois lotes.
  useEffect(() => {
    if (!running || demand === 0 || exhausted) {
      return;
    }

    const id = runId.current + 1;

    runId.current = id;

    let cancelled = false;
    const alive = () => !cancelled && runId.current === id;

    void (async () => {
      const outcome = await discoverAction({
        profileId,
        cursor: cursor.current ?? undefined,
        q: query || undefined,
        expanded,
      });

      if (!alive()) {
        return;
      }

      setCompleted((value) => value + 1);

      if (outcome.status === "error") {
        setError(outcome.message);
        stop();

        return;
      }

      const result = outcome.result;

      batches.current += 1;
      fetchMs.current += result.fetchMs;
      cursor.current = result.nextCursor;
      setTotal(result.total);
      setFailed(result.failedSources);

      setItems((previous) => merge(previous, result.items, saved.current));

      if (
        result.exhausted ||
        !result.nextCursor ||
        batches.current >= MAX_BATCHES
      ) {
        setExhausted(result.exhausted ?? "fim");
        stop();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demand, running, exhausted, profileId, query, expanded, stop]);

  // Pede o próximo lote quando o fim da lista aparece na tela.
  useEffect(() => {
    const node = sentinel.current;

    if (!node || !running || pending || exhausted) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        askForMore();
      }
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [running, pending, exhausted, items.length, askForMore]);

  const marked = countMarked(filters);

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-4">
      {/* Cabeçalho e extração seguem estreitos: texto em linha larga é ruim de
          ler. Só a grade de vagas aproveita a tela inteira. */}
      <div className="max-w-4xl">
        <JobsTabs savedCount={savedCount} />
      </div>

      <section className="cine-reveal cine-glass flex flex-col gap-3 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Procurar vagas</h2>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Enquanto ligada, traz vagas de Gupy, Greenhouse, Ashby, Lever e
              agregadores de remoto. Nada é gravado até você salvar.
              {expanded && (
                <>
                  {" "}
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Ampliada, inclui InfoJobs e Vagas.com — mais vagas, e uns 10
                    segundos a mais na primeira busca.
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Filtros
              {marked > 0 && (
                <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {marked}
                </span>
              )}
            </button>

            {/* Acervo diferente: alternar zera a lista, senão o começo viria
                da busca estreita e o resto da ampliada. */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={expanded}
                onChange={(event) => {
                  setExpanded(event.target.checked);
                  setItems([]);
                  setTotal(null);
                  setExhausted(null);
                  cursor.current = null;
                }}
                className="size-4 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
              />
              Ampliar a área de busca
            </label>

            <button
              type="button"
              onClick={running ? stop : start}
              aria-pressed={running}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                running
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-gradient-to-r from-accent to-accent-2 text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/70 hover:brightness-110"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  running ? "animate-pulse bg-white" : "bg-zinc-950/60"
                }`}
              />
              {running ? "Parar busca" : "Iniciar busca"}
              {running && startedAt !== null && (
                <SearchTimer key={startedAt} startedAt={startedAt} />
              )}
            </button>
          </div>
        </div>

        {/* GET puro: o filtro de texto fica na URL, é compartilhável e não
            precisa de JS. Os demais critérios vivem no perfil. */}
        <form action="/vagas" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Filtrar por cargo ou tecnologia"
            className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Filtrar
          </button>
        </form>

        <Status
          items={items.length}
          total={total}
          pending={pending}
          exhausted={exhausted}
          failed={failed}
          error={error}
          lastRun={lastRun}
        />
      </section>

      <div className="max-w-4xl">
        <ExtractCard profileId={profileId} />
      </div>

      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => (
            <ResultCard
              key={item.result.url}
              index={index}
              profileId={profileId}
              item={item}
              dismissible
            />
          ))}
        </ul>
      )}

      {items.length === 0 && !running && (
        <p className="cine-glass rounded-2xl px-6 py-14 text-center text-sm text-zinc-400">
          Inicie a busca para começar.
        </p>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      <FiltersModal
        open={filtersOpen}
        preferences={filters}
        pending={savingFilters}
        onCancel={() => setFiltersOpen(false)}
        onConfirm={applyFilters}
      />
    </div>
  );
}

function Status({
  items,
  total,
  pending,
  exhausted,
  failed,
  error,
  lastRun,
}: {
  items: number;
  total: number | null;
  pending: boolean;
  exhausted: Exhaustion | null;
  failed: string[];
  error: string | null;
  lastRun: RunStats | null;
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
      {pending && items === 0 && <span>Consultando os portais…</span>}

      {items > 0 && (
        <span>
          {items} {items === 1 ? "vaga" : "vagas"} na tela
          {total !== null && ` — ${total} passam no seu filtro`}
        </span>
      )}

      {/* As duas mensagens são diferentes de propósito: uma pede para afrouxar
          o filtro, a outra diz que você está em dia. */}
      {exhausted === "fim" && (
        <span className="text-zinc-700 dark:text-zinc-300">
          Acabaram as vagas que passam no seu filtro.
        </span>
      )}

      {exhausted === "nada-novo" && (
        <span className="text-zinc-700 dark:text-zinc-300">
          Você já viu todas as vagas disponíveis. Nada novo por enquanto.
        </span>
      )}

      {/* O cronômetro zera ao parar; o número da corrida sobrevive aqui. */}
      {lastRun && (
        <span>
          Última busca: {format(lastRun.elapsedMs)} ligada · {lastRun.batches}{" "}
          {lastRun.batches === 1 ? "lote" : "lotes"} ·{" "}
          {(lastRun.fetchMs / 1000).toFixed(1)}s de rede
        </span>
      )}

      {failed.length > 0 && (
        <span>
          Sem resposta de {failed.join(", ")} nesta busca — a lista está
          incompleta.
        </span>
      )}
    </div>
  );
}

/**
 * Junta o lote novo ao que já está na tela, sem repetir.
 *
 * Necessário mesmo com cursor estável: o cache do servidor pode expirar no meio
 * da sessão e trazer de volta uma vaga que já estava aqui.
 */
function merge(
  previous: SearchResultItem[],
  incoming: JobSearchResult[],
  saved: Set<string>,
): SearchResultItem[] {
  const seen = new Set(previous.map((item) => item.result.url));
  const added = incoming
    .filter((result) => !seen.has(result.url))
    .map((result) => ({ result, saved: saved.has(result.url) }));

  return added.length > 0 ? [...previous, ...added] : previous;
}
