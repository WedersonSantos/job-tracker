import { z } from 'zod';

export const MAX_RESUME_PDF_BYTES = 5 * 1024 * 1024;
export const resumeFileInfoSchema = z.object({
  fileName: z.string(), size: z.number().int().positive(), savedAt: z.iso.datetime(),
});
export type ResumeFileInfo = z.infer<typeof resumeFileInfoSchema>;
export const uploadResumeFileSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(200).regex(/\.pdf$/i, 'Selecione um arquivo PDF.'),
  content: z.string().min(1).max(Math.ceil(MAX_RESUME_PDF_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'PDF inválido.'),
});
export type UploadResumeFileInput = z.infer<typeof uploadResumeFileSchema>;
