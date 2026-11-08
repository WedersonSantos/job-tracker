import { z } from 'zod';
import { externalUrlSchema } from './job';

/**
 * Preenchimento assistido de formulário (funcionalidade 6 do §1).
 *
 * O contrato afirma o que o código faz: `submitted` é `false` literal, não
 * booleano. Um `z.boolean()` deixaria a porta aberta para alguém um dia mandar
 * `true` — e o §5 diz que formulário de candidatura NUNCA é submetido
 * automaticamente.
 */
export const fillFormSchema = z.strictObject({
  url: externalUrlSchema,
});

export type FillFormInput = z.infer<typeof fillFormSchema>;

export const fillReportSchema = z.object({
  url: z.string(),
  /** O que foi preenchido, para você conferir sem caçar na tela. */
  filled: z.array(z.object({ what: z.string(), value: z.string() })),
  /** Campos que o código não reconheceu. Ficam com você. */
  skipped: z.array(z.string()),
  submitted: z.literal(false),
  message: z.string().optional(),
  attachment: z.object({ status: z.enum(['attached', 'skipped']), fileName: z.string(), message: z.string() }).optional(),
});

export type FillReport = z.infer<typeof fillReportSchema>;
