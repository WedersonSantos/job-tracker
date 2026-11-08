import { z } from "zod";

/** Modalidade de trabalho da vaga. Espelha o enum WorkModel do Prisma. */
export const workModelSchema = z.enum(["remoto", "hibrido", "presencial"]);

export type WorkModel = z.infer<typeof workModelSchema>;

export const WORK_MODELS = workModelSchema.options;

/** Espelha o enum ContractType do Prisma. */
export const contractTypeSchema = z.enum([
  "clt",
  "pj",
  "estagio",
  "temporario",
]);

export type ContractType = z.infer<typeof contractTypeSchema>;

export const CONTRACT_TYPES = contractTypeSchema.options;

/**
 * Link externo, restrito a http/https.
 *
 * `z.url()` sozinho NÃO basta: ele valida sintaxe pelo construtor `URL`, e
 * `javascript:alert(1)`, `data:` e `file:` são URLs sintaticamente válidas.
 * Como esse valor vira `href` na tela, aceitar `javascript:` seria XSS
 * armazenado — a vaga vem de portal externo, que é dado não confiável
 * (seção 5 do CLAUDE.md).
 */
export const externalUrlSchema = z.url({
  protocol: /^https?$/,
  error: "Use um link http ou https",
});

/**
 * Resultado de busca em portais.
 *
 * Deliberadamente SEM `id`: é dado externo, ainda não é uma vaga sua. A
 * diferença de forma em relação a `jobSchema` é o que impede confundir "achei
 * isso num portal" com "isto está no meu banco". Só o salvar materializa.
 */
export const jobSearchResultSchema = z.object({
  company: z.string(),
  title: z.string(),
  url: externalUrlSchema,
  /** De onde veio: linkedin, greenhouse, lever, gupy… */
  source: z.string(),
  description: z.string().nullable(),
  stack: z.array(z.string()),
  requirements: z.array(z.string()),
  benefits: z.array(z.string()),
  seniority: z.string().nullable(),
  workModel: workModelSchema.nullable(),
  contractType: contractTypeSchema.nullable(),
  location: z.string().nullable(),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  salaryCurrency: z.string().nullable(),
  weeklyHours: z.number().int().nullable(),
  postedAt: z.iso.datetime().nullable(),
  availability: z
    .object({
      state: z.enum(["active", "unknown"]),
      checkedAt: z.iso.datetime(),
      reason: z.string(),
    })
    .optional(),
});

export type JobSearchResult = z.infer<typeof jobSearchResultSchema>;

export const jobSearchResultListSchema = z.array(jobSearchResultSchema);

/** A vaga já registrada, com id. É o que a página de detalhe consome. */
export const jobSchema = jobSearchResultSchema.omit({ postedAt: true }).extend({
  id: z.string(),
  url: z.string().nullable(),
  source: z.string().nullable(),
  extractedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Job = z.infer<typeof jobSchema>;

/** Salvar materializa o resultado externo como vaga do perfil. */
export const saveJobSchema = z.strictObject({
  profileId: z.string().min(1),
  result: jobSearchResultSchema,
});

export type SaveJobInput = z.infer<typeof saveJobSchema>;

/**
 * Vaga salva, com a candidatura ativa daquele perfil quando existir. É esse
 * campo que decide entre mostrar "Aplicar" e "Acompanhar candidatura".
 */
export const savedJobSchema = z.object({
  jobId: z.string(),
  savedAt: z.iso.datetime(),
  job: jobSchema,
  application: z.object({ id: z.string(), status: z.string() }).nullable(),
});

export type SavedJob = z.infer<typeof savedJobSchema>;

export const savedJobListSchema = z.array(savedJobSchema);
