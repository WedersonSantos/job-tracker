import { z } from 'zod';
import { externalUrlSchema } from './job';

/**
 * Mês e ano, sem dia. É o que o LinkedIn exporta e o que um currículo usa —
 * ninguém escreve "de 03/06/2019 a 14/11/2022".
 */
const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM');

const shortText = z.string().trim().max(160);
const longText = z.string().trim().max(4000);

export const experienceSchema = z.object({
  company: z.string().trim().min(1, 'Informe a empresa').max(160),
  role: z.string().trim().min(1, 'Informe o cargo').max(160),
  location: shortText.nullable(),
  startDate: yearMonth.nullable(),
  endDate: yearMonth.nullable(),
  current: z.boolean(),
  description: longText.nullable(),
});

export const educationSchema = z.object({
  school: z.string().trim().min(1, 'Informe a instituição').max(160),
  degree: shortText.nullable(),
  field: shortText.nullable(),
  startDate: yearMonth.nullable(),
  endDate: yearMonth.nullable(),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(160),
  url: externalUrlSchema.nullable(),
  description: longText.nullable(),
});

export const languageSchema = z.object({
  name: z.string().trim().min(1, 'Informe o idioma').max(80),
  /** Texto livre: o LinkedIn exporta rótulos variados ("Native or bilingual"). */
  level: shortText.nullable(),
});

export const certificationSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(200),
  issuer: shortText.nullable(),
  date: yearMonth.nullable(),
});

/**
 * O currículo estruturado. Vive no campo `resume` (Json) do Profile, validado
 * aqui na borda do Nest — sem isso o Prisma aceitaria qualquer forma.
 *
 * Guarda `birthDate`, e não idade: idade gravada envelhece sozinha e fica
 * errada em silêncio no aniversário seguinte.
 */
export const resumeSchema = z.object({
  birthDate: z.iso.date().nullable(),
  summary: longText.nullable(),
  experiences: z.array(experienceSchema),
  education: z.array(educationSchema),
  skills: z.array(z.string().trim().min(1).max(80)),
  projects: z.array(projectSchema),
  languages: z.array(languageSchema),
  certifications: z.array(certificationSchema),
});

export type Resume = z.infer<typeof resumeSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Language = z.infer<typeof languageSchema>;
export type Certification = z.infer<typeof certificationSchema>;

export const emptyResume: Resume = {
  birthDate: null,
  summary: null,
  experiences: [],
  education: [],
  skills: [],
  projects: [],
  languages: [],
  certifications: [],
};

/** Perfis públicos. Restrito a http/https pelo mesmo motivo das vagas. */
export const profileLinksSchema = z.object({
  linkedin: externalUrlSchema.nullable(),
  github: externalUrlSchema.nullable(),
  website: externalUrlSchema.nullable(),
  /** Default preserves existing profiles and frozen resume versions. */
  presentationVideo: externalUrlSchema.nullable().default(null),
});

export type ProfileLinks = z.infer<typeof profileLinksSchema>;

export const emptyLinks: ProfileLinks = {
  linkedin: null,
  github: null,
  website: null,
  presentationVideo: null,
};

/** Idade derivada da data de nascimento, nunca armazenada. */
export function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) {
    return null;
  }

  const born = new Date(birthDate);

  if (Number.isNaN(born.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) {
    age -= 1;
  }

  return age >= 0 && age < 130 ? age : null;
}
