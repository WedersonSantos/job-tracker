import { z } from "zod";
import { profileLinksSchema, resumeSchema, type Resume } from "./resume";

export const resumeImportSchema = z.object({
  fullName: z.string().max(160).nullable(),
  headline: z.string().max(120).nullable(),
  email: z.email().nullable(),
  phone: z.string().max(40).nullable(),
  location: z.string().max(160).nullable(),
  links: profileLinksSchema,
  resume: resumeSchema,
  warnings: z.array(z.string().max(300)).max(20),
});
export type ResumeImport = z.infer<typeof resumeImportSchema>;

/** Only empty sections are filled. An uploaded file never erases manual edits. */
export function mergeResumeImport(current: Resume, incoming: Resume): Resume {
  return {
    birthDate: current.birthDate ?? incoming.birthDate,
    summary: current.summary?.trim() ? current.summary : incoming.summary,
    experiences: current.experiences.length
      ? current.experiences
      : incoming.experiences,
    education: current.education.length
      ? current.education
      : incoming.education,
    skills: current.skills.length ? current.skills : incoming.skills,
    projects: current.projects.length ? current.projects : incoming.projects,
    languages: current.languages.length
      ? current.languages
      : incoming.languages,
    certifications: current.certifications.length
      ? current.certifications
      : incoming.certifications,
  };
}
