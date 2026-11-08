import "server-only";
import { z } from "zod";
import {
  discoverResultSchema,
  fillReportSchema,
  jobSchema,
  jobSearchResultSchema,
  savedJobListSchema,
  savedJobSchema,
  sourceOverviewSchema,
} from "@recruit/shared";
import type { SourceSettings } from "@recruit/shared";

export async function openNativeChrome(
  profileId: string,
  url: string,
  chromeProfile?: string,
  prepareOnly = false,
) {
  return z
    .object({ message: z.string(), requestId: z.string().uuid() })
    .parse(
      await request(
        `/form-fill/chrome?profileId=${encodeURIComponent(profileId)}`,
        {
          method: "POST",
          body: JSON.stringify({ url, chromeProfile, prepareOnly }),
        },
      ),
    );
}
import type {
  DiscoverResult,
  FillReport,
  Job,
  JobSearchResult,
  SavedJob,
} from "@recruit/shared";
import { env } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (response.status === 204) {
    return null;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body as {
      message?: string;
      issues?: { field: string; message: string }[];
    } | null;

    throw new ApiError(
      detail?.message ?? `Falha na requisição (${response.status})`,
      response.status,
      detail?.issues,
    );
  }

  return body;
}

export async function getSourceOverview() {
  return sourceOverviewSchema.parse(await request("/jobs/sources"));
}
export async function saveSourceSettings(settings: SourceSettings) {
  return sourceOverviewSchema.parse(
    await request("/jobs/sources", {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  );
}
export async function checkSources() {
  return sourceOverviewSchema.parse(
    await request("/jobs/sources/check", { method: "POST" }),
  );
}

/** Um lote da descoberta. O cursor é opaco: vem do lote anterior, sem ser lido. */
export async function discoverJobs(params: {
  profileId: string;
  cursor?: string;
  q?: string;
  expanded?: boolean;
}): Promise<DiscoverResult> {
  const search = new URLSearchParams({ profileId: params.profileId });

  if (params.cursor) search.set("cursor", params.cursor);
  if (params.q) search.set("q", params.q);
  // Só quando ligado: z.coerce.boolean() trata "false" como verdadeiro, então
  // o parâmetro ausente é a única forma segura de dizer "não".
  if (params.expanded) search.set("expanded", "true");

  return discoverResultSchema.parse(
    await request(`/jobs/discover?${search.toString()}`),
  );
}

export async function listSavedJobs(profileId: string): Promise<SavedJob[]> {
  return savedJobListSchema.parse(
    await request(`/jobs/saved?profileId=${encodeURIComponent(profileId)}`),
  );
}

export async function saveJob(
  profileId: string,
  result: JobSearchResult,
): Promise<SavedJob> {
  return savedJobSchema.parse(
    await request("/jobs/saved", {
      method: "POST",
      body: JSON.stringify({ profileId, result }),
    }),
  );
}

export async function unsaveJob(
  profileId: string,
  jobId: string,
): Promise<void> {
  await request(
    `/jobs/saved/${jobId}?profileId=${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
  );
}

/** Recusa a vaga. Não grava vaga: só a URL e o rótulo, para poder desfazer. */
export async function dismissJob(
  profileId: string,
  result: JobSearchResult,
): Promise<void> {
  await request("/jobs/dismissed", {
    method: "POST",
    body: JSON.stringify({
      profileId,
      url: result.url,
      company: result.company,
      title: result.title,
      source: result.source,
    }),
  });
}

export async function undismissJob(
  profileId: string,
  url: string,
): Promise<void> {
  await request("/jobs/dismissed", {
    method: "DELETE",
    body: JSON.stringify({ profileId, url }),
  });
}

export async function getJob(id: string): Promise<Job> {
  return jobSchema.parse(await request(`/jobs/${id}`));
}

/**
 * Extrai uma vaga a partir da URL. Não persiste: devolve o mesmo formato de um
 * resultado de busca, que só vira `Job` quando salvo.
 */
export async function extractJob(url: string): Promise<JobSearchResult> {
  return jobSearchResultSchema.parse(
    await request("/jobs/extract", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  );
}

/**
 * Abre o formulário da vaga num navegador e preenche o que já é seu.
 *
 * NÃO envia. O §5 é categórico, e o `submitted: false` do contrato é literal —
 * o schema nem aceitaria `true`.
 */
export async function fillJobForm(
  profileId: string,
  url: string,
): Promise<FillReport> {
  return fillReportSchema.parse(
    await request(`/form-fill?profileId=${encodeURIComponent(profileId)}`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  );
}
