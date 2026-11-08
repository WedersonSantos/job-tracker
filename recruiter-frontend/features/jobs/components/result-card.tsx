"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { IconBookmark, IconExternalLink, IconX } from "@/components/icons";
import { Tilt } from "@/components/motion";
import {
  dismissJobAction,
  saveJobAction,
  undismissJobAction,
} from "@/features/jobs/actions";
import {
  JobTags,
  StackTags,
  formatSalary,
} from "@/features/jobs/components/job-meta";
import type { JobSearchResult } from "@/features/jobs/types";
import { safeExternalUrl } from "@/lib/safe-url";

/**
 * O card de uma vaga externa.
 *
 * Vive fora do `job-search` porque tem três consumidores: a descoberta, a
 * extração por link e, na fase 2, a revisão de descartadas. Os três recebem o
 * mesmo `JobSearchResult`, e é isso que faz uma vaga extraída seguir pelo
 * mesmo caminho de salvar que uma vaga descoberta.
 */

export interface SearchResultItem {
  result: JobSearchResult;
  /** Já está em "Minhas vagas" — casado por URL no servidor. */
  saved: boolean;
}

/**
 * Nome da fonte como você a reconhece, não como o código a chama.
 *
 * `linkedin-alerts` diz de onde a vaga veio de um jeito que importa: ela
 * chegou no SEU email, escolhida pelo LinkedIn para o seu perfil — é um sinal
 * de aderência que a pontuação não calcula.
 */
const SOURCE_LABELS: Record<string, string> = {
  "linkedin-alerts": "alerta LinkedIn",
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  gupy: "Gupy",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  "portais-br": "portais BR",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function ResultCard({
  index = 0,
  profileId,
  item,
  dismissible = false,
}: {
  /** Posição na grade, para a cascata de entrada. */
  index?: number;
  profileId: string;
  item: SearchResultItem;
  /**
   * Descartar só faz sentido na descoberta. Numa vaga que você mesmo colou o
   * link, recusar seria recusar a própria escolha.
   */
  dismissible?: boolean;
}) {
  const { result } = item;
  const [dismissed, setDismissed] = useState(false);
  // Estado local, e não só a prop: depois de salvar, o card confirma na hora,
  // sem depender de a página inteira revalidar.
  const [saved, setSaved] = useState(item.saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const salary = formatSalary(result);
  const portalUrl = safeExternalUrl(result.url);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await saveJobAction(profileId, result);

      if (outcome.status === "error") {
        setError(outcome.message);

        return;
      }

      setSaved(true);
      setDismissed(false);
    });
  };

  const run = (action: () => Promise<{ status: string; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const outcome = await action();

      if (outcome.status === "error") {
        setError(outcome.message ?? "Algo deu errado.");
      }
    });
  };

  // O card não some da grade: sumir reflui as quatro colunas inteiras a cada
  // clique, e o desfazer teria que morar em outro lugar. Ele encolhe e fica.
  if (dismissed) {
    return (
      <li className="flex h-full flex-col justify-center gap-2 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-zinc-400">
        <span className="line-clamp-2">
          Descartada — {result.company}: {result.title}
        </span>
        <button
          type="button"
          onClick={() => {
            setDismissed(false);
            run(() => undismissJobAction(profileId, result.url));
          }}
          disabled={pending}
          className="cursor-pointer self-start text-sm font-medium underline underline-offset-4 transition hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
        >
          Desfazer
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li
      className="cine-reveal"
      // A cascata recomeça a cada lote de 40 da rolagem infinita: sem o
      // módulo, o lote novo entraria inteiro de uma vez, no atraso máximo.
      style={{ ["--i" as string]: index % 40 }}
    >
      <Tilt className="h-full rounded-2xl">
        <div className="cine-glass flex h-full flex-col gap-3 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className="truncate font-[family-name:var(--font-display)] text-base font-semibold"
                title={result.company}
              >
                {result.company}
              </span>
              {/* Duas linhas no máximo: sem isto cada card da grade tem uma altura
                  diferente, porque os títulos variam de 3 a 12 palavras. */}
              <span
                className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400"
                title={result.title}
              >
                {result.title}
              </span>
            </div>
            <span
              className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              title={`Origem: ${sourceLabel(result.source)}`}
            >
              {sourceLabel(result.source)}
            </span>
          </div>

          <JobTags job={result} />
          {result.availability && (
            <p
              className="text-xs text-zinc-500 dark:text-zinc-400"
              title={`${result.availability.reason} Verificado em ${new Date(result.availability.checkedAt).toLocaleString("pt-BR")}.`}
            >
              {result.availability.state === "active"
                ? "Prazo de candidatura vigente"
                : "Disponibilidade não confirmada"}
            </p>
          )}
          <StackTags stack={result.stack} max={4} />

          {salary && (
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {salary}
            </span>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {/* mt-auto: as ações encostam no rodapé, então os cards da linha
              terminam alinhados mesmo com conteúdos de tamanhos diferentes. */}
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                <IconExternalLink />
                Ver no portal
              </a>
            )}

            {dismissible && !saved && (
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  run(() => dismissJobAction(profileId, result));
                }}
                disabled={pending}
                title="Descartar — não aparece mais na busca"
                aria-label="Descartar vaga"
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                <IconX />
              </button>
            )}

            {saved ? (
              <Link
                href="/vagas/salvas"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-700 underline underline-offset-4 transition hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
              >
                <IconBookmark />
                Salva — ver em Minhas vagas
              </Link>
            ) : (
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <IconBookmark />
                {pending ? "Salvando…" : "Salvar"}
              </button>
            )}
          </div>
        </div>
      </Tilt>
    </li>
  );
}
