import "server-only";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { emptyResume } from "@recruit/shared";
import type { Resume } from "@recruit/shared";

/** O ZIP inteiro. Export de perfil raramente passa de alguns MB. */
export const MAX_ZIP_BYTES = 20 * 1024 * 1024;

/**
 * Teto por arquivo DESCOMPRIMIDO. O fflate expande em memória, e um ZIP de
 * poucos KB pode declarar gigabytes — sem este limite, uma zip bomb derruba o
 * processo do Next.
 */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/**
 * Só estes arquivos são lidos, por nome. Nada de iterar as entradas do ZIP:
 * o arquivo vem do usuário e não há motivo para tocar no que não conhecemos.
 */
const WANTED = new Set([
  "Profile.csv",
  "Positions.csv",
  "Education.csv",
  "Skills.csv",
  "Languages.csv",
  "Certifications.csv",
]);

export interface ImportOutcome {
  resume: Resume;
  fullName: string | null;
  /** Dados pessoais que o Profile guarda fora do currículo. */
  headline: string | null;
  location: string | null;
  /** Arquivos esperados que não vieram — reportado, não silenciado. */
  missing: string[];
  /** Quantos itens saíram de cada seção, para você conferir antes de salvar. */
  counts: Record<string, number>;
}

export class ImportError extends Error {}

export async function parseLinkedInExport(file: File): Promise<ImportOutcome> {
  if (file.size > MAX_ZIP_BYTES) {
    throw new ImportError(
      `Arquivo muito grande (${Math.round(file.size / 1024 / 1024)} MB). O limite é ${MAX_ZIP_BYTES / 1024 / 1024} MB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;

  try {
    entries = unzipSync(bytes, {
      // O filtro roda ANTES de descomprimir: é o que impede a zip bomb.
      filter: (entry) =>
        WANTED.has(basename(entry.name)) && entry.originalSize < MAX_ENTRY_BYTES,
    });
  } catch {
    throw new ImportError(
      "Não consegui abrir o arquivo. Envie o ZIP que o LinkedIn gera em Configurações → Privacidade de dados → Obter uma cópia dos seus dados.",
    );
  }

  const files = new Map<string, string>();

  for (const [name, content] of Object.entries(entries)) {
    files.set(basename(name), new TextDecoder("utf-8").decode(content));
  }

  const missing = [...WANTED].filter((name) => !files.has(name));

  if (missing.length === WANTED.size) {
    throw new ImportError(
      "O ZIP não contém nenhum dos arquivos esperados. Confira se é mesmo o export do LinkedIn.",
    );
  }

  const profile = rows(files.get("Profile.csv"), "First Name")[0] ?? {};
  const positions = rows(files.get("Positions.csv"), "Company Name");
  const education = rows(files.get("Education.csv"), "School Name");
  const skills = rows(files.get("Skills.csv"), "Name");
  const languages = rows(files.get("Languages.csv"), "Name");
  const certifications = rows(files.get("Certifications.csv"), "Name");

  const resume: Resume = {
    ...emptyResume,
    summary: pick(profile, "Summary"),
    experiences: positions.map((row) => ({
      company: pick(row, "Company Name") ?? "",
      role: pick(row, "Title") ?? "",
      location: pick(row, "Location"),
      startDate: toYearMonth(pick(row, "Started On")),
      endDate: toYearMonth(pick(row, "Finished On")),
      current: !pick(row, "Finished On"),
      description: pick(row, "Description"),
    })).filter((item) => item.company && item.role),
    education: education.map((row) => ({
      school: pick(row, "School Name") ?? "",
      degree: pick(row, "Degree Name"),
      field: pick(row, "Notes"),
      startDate: toYearMonth(pick(row, "Start Date")),
      endDate: toYearMonth(pick(row, "End Date")),
    })).filter((item) => item.school),
    skills: skills.map((row) => pick(row, "Name") ?? "").filter(Boolean),
    languages: languages.map((row) => ({
      name: pick(row, "Name") ?? "",
      level: pick(row, "Proficiency"),
    })).filter((item) => item.name),
    certifications: certifications.map((row) => ({
      name: pick(row, "Name") ?? "",
      issuer: pick(row, "Authority"),
      date: toYearMonth(pick(row, "Started On")),
    })).filter((item) => item.name),
  };

  return {
    resume,
    fullName: [pick(profile, "First Name"), pick(profile, "Last Name")].filter(Boolean).join(" ") || null,
    headline: pick(profile, "Headline"),
    location: pick(profile, "Geo Location"),
    missing,
    counts: {
      experiências: resume.experiences.length,
      formação: resume.education.length,
      competências: resume.skills.length,
      idiomas: resume.languages.length,
      certificações: resume.certifications.length,
    },
  };
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Lê um CSV do export.
 *
 * O LinkedIn costuma pôr linhas de aviso antes do cabeçalho, então procuramos
 * a linha que contém uma coluna conhecida em vez de assumir a primeira. As
 * colunas são casadas por NOME, não por posição — a ordem muda entre exports.
 *
 * Falha em silêncio de propósito: um arquivo que não bate vira lista vazia e é
 * reportado como ausente, sem derrubar a importação inteira.
 */
function rows(content: string | undefined, anchor: string): Record<string, string>[] {
  if (!content) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(anchor.toLowerCase()),
  );

  if (headerIndex === -1) {
    return [];
  }

  try {
    return parse(lines.slice(headerIndex).join("\n"), {
      columns: (header: string[]) => header.map((h) => h.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];
  } catch {
    return [];
  }
}

function pick(row: Record<string, string>, column: string): string | null {
  const key = Object.keys(row).find(
    (candidate) => candidate.toLowerCase() === column.toLowerCase(),
  );
  const value = key ? row[key]?.trim() : "";

  return value ? value : null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * O export mistura formatos: "Mar 2021", "2021", "2021-03-01". Normaliza para
 * AAAA-MM, que é o que o resumeSchema aceita; o que não reconhecer vira null,
 * e o campo fica vazio para você preencher.
 */
function toYearMonth(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})/.exec(value);
  if (iso) {
    return `${iso[1]}-${iso[2]}`;
  }

  const named = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(value);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];

    return month ? `${named[2]}-${month}` : null;
  }

  const yearOnly = /^(\d{4})$/.exec(value);
  if (yearOnly) {
    return `${yearOnly[1]}-01`;
  }

  return null;
}
