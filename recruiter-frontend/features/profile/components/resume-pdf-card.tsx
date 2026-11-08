"use client";
import { useActionState, useId, useEffect, useRef } from "react";
import type { ResumeFileInfo, ResumeImport } from "@recruit/shared";
import {
  saveResumeFileAction,
  type ResumeFileState,
} from "../resume-file-actions";

export function ResumePdfCard({
  profileId,
  initialFile,
  onImported,
}: {
  profileId: string;
  initialFile: ResumeFileInfo | null;
  onImported: (value: ResumeImport) => void;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(
    saveResumeFileAction.bind(null, profileId),
    { status: "idle" } as ResumeFileState,
  );
  const file = state.status === "success" ? state.file : initialFile;
  const processed = useRef<ResumeFileState | null>(null);
  useEffect(() => {
    if (
      state !== processed.current &&
      state.status === "success" &&
      state.imported
    ) {
      processed.current = state;
      onImported(state.imported);
    }
  }, [state, onImported]);
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">PDF para candidaturas</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Escolha o currículo que você envia às empresas. Uma cópia fica salva
        neste computador, por perfil, e será anexada aos campos de currículo
        reconhecidos. A leitura local do PDF também preenche os campos vazios
        para revisão, sem chave de API e sem enviar o arquivo a serviços
        externos.
      </p>
      <p className="break-words text-sm">
        {file
          ? `Arquivo salvo: ${file.fileName} (${Math.ceil(file.size / 1024)} KB)`
          : "Nenhum PDF salvo neste perfil."}
      </p>
      <form action={action} className="flex min-w-0 flex-col gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {file ? "Substituir currículo em PDF" : "Selecionar currículo em PDF"}
        </label>
        <input
          id={id}
          type="file"
          name="resumePdf"
          accept=".pdf,application/pdf"
          disabled={pending}
          className="w-full min-w-0 cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1 dark:border-zinc-700 dark:file:bg-zinc-800 dark:file:text-zinc-100"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Até 5 MB. Guarde e leia o PDF; depois revise os dados e use Salvar.
          PDFs digitalizados como imagem podem não ter texto para leitura.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? "Processando PDF…" : "Guardar e ler PDF"}
          </button>
          {file && (
            <button
              type="submit"
              name="operation"
              value="import"
              disabled={pending}
              className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Ler PDF salvo
            </button>
          )}
          {file && (
            <button
              type="submit"
              name="operation"
              value="remove"
              disabled={pending}
              className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Remover PDF
            </button>
          )}
        </div>
      </form>
      {state.status !== "idle" && (
        <p
          role="status"
          className={`text-sm ${state.status === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {state.message}
        </p>
      )}
      {state.status === "success" &&
      (state.warning || state.imported?.warnings.length) ? (
        <div
          role="status"
          className="text-sm text-amber-700 dark:text-amber-300"
        >
          {state.warning && <p>{state.warning}</p>}
          {state.imported?.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
