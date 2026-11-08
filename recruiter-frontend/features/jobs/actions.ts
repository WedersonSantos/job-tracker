"use server";

import { revalidatePath } from "next/cache";
import type {
  FillReport,
  DiscoverResult,
  JobSearchResult,
} from "@recruit/shared";
import { createApplication } from "@/features/applications/api";
import {
  ApiError,
  discoverJobs,
  dismissJob,
  extractJob,
  fillJobForm,
  saveJob,
  undismissJob,
  unsaveJob,
  openNativeChrome,
} from "@/features/jobs/api";
import type { JobActionState } from "@/features/jobs/types";

function toError(error: unknown, fallback: string): JobActionState {
  if (error instanceof ApiError) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: fallback };
}

export async function saveJobAction(
  profileId: string,
  result: JobSearchResult,
): Promise<JobActionState> {
  try {
    await saveJob(profileId, result);
    // Sem revalidar "/vagas": a descoberta acumula lotes no cliente, e
    // revalidar aquela rota refaz o fan-out nos portais a cada vaga salva —
    // segundos de espera por clique, para reconstruir uma lista que o próprio
    // card já atualizou localmente.
    revalidatePath("/vagas/salvas");

    return { status: "success" };
  } catch (error) {
    return toError(error, "Não foi possível salvar a vaga.");
  }
}

/**
 * Descarte e desfazer não revalidam rota nenhuma: a lista da descoberta vive
 * no cliente, e revalidar "/vagas" refaria o fan-out nos portais a cada clique.
 */
export async function dismissJobAction(
  profileId: string,
  result: JobSearchResult,
): Promise<JobActionState> {
  try {
    await dismissJob(profileId, result);

    return { status: "success" };
  } catch (error) {
    return toError(error, "Não foi possível descartar a vaga.");
  }
}

export async function undismissJobAction(
  profileId: string,
  url: string,
): Promise<JobActionState> {
  try {
    await undismissJob(profileId, url);

    return { status: "success" };
  } catch (error) {
    return toError(error, "Não foi possível desfazer.");
  }
}

export async function unsaveJobAction(
  profileId: string,
  jobId: string,
): Promise<JobActionState> {
  try {
    await unsaveJob(profileId, jobId);
    revalidatePath("/vagas/salvas");

    return { status: "success" };
  } catch (error) {
    return toError(error, "Não foi possível remover a vaga.");
  }
}

/**
 * Aplicar a partir de uma vaga já registrada manda `jobId`, e não empresa e
 * cargo. É o que faz a candidatura apontar para a MESMA vaga salva — mandando
 * os textos, o backend criaria um Job novo e a vaga salva nunca se
 * reconheceria como aplicada.
 */
export async function applyToJobAction(
  profileId: string,
  jobId: string,
): Promise<JobActionState> {
  try {
    await createApplication({ profileId, jobId });
    revalidatePath("/");
    revalidatePath("/vagas/salvas");

    return { status: "success" };
  } catch (error) {
    return toError(error, "Não foi possível registrar a candidatura.");
  }
}

export type ExtractState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; result: JobSearchResult };

/**
 * Extrai e devolve para revisão. Como a busca, não grava nada — quem grava é o
 * botão Salvar.
 */
export async function extractJobAction(
  _prev: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const url = formData.get("url");

  if (typeof url !== "string" || url.trim() === "") {
    return { status: "error", message: "Cole o link da vaga." };
  }

  try {
    return { status: "success", result: await extractJob(url.trim()) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: "error", message: error.message };
    }

    return { status: "error", message: "Não consegui extrair a vaga." };
  }
}

export type DiscoverState =
  | { status: "error"; message: string }
  | { status: "success"; result: DiscoverResult };

/**
 * Um lote da descoberta.
 *
 * É Server Action e não fetch do navegador porque `API_URL` é do servidor: o
 * cliente nunca fala com a porta 3333 direto.
 */
export async function discoverAction(params: {
  profileId: string;
  cursor?: string;
  q?: string;
  expanded?: boolean;
}): Promise<DiscoverState> {
  try {
    return { status: "success", result: await discoverJobs(params) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: "error", message: error.message };
    }

    return {
      status: "error",
      message: "Não consegui buscar vagas nos portais agora.",
    };
  }
}

export type FillState =
  | { status: "idle" }
  | { status: "success"; report: FillReport }
  | { status: "error"; message: string };

/**
 * Abre o navegador e preenche o formulário da vaga.
 *
 * Não revalida rota nenhuma: nada muda no banco. O efeito é uma janela de
 * navegador aberta na sua máquina, esperando você revisar e enviar.
 */
export async function fillFormAction(
  profileId: string,
  url: string,
): Promise<FillState> {
  try {
    return { status: "success", report: await fillJobForm(profileId, url) };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Não consegui abrir o navegador.",
    };
  }
}

export async function openNativeChromeAction(
  profileId: string,
  url: string,
  chromeProfile?: string,
  prepareOnly = false,
) {
  try {
    return {
      status: "success",
      ...(await openNativeChrome(profileId, url, chromeProfile, prepareOnly)),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Não consegui abrir o perfil do Chrome.",
    };
  }
}
