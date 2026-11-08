import { z } from 'zod';
import { defaultJobPreferences, jobPreferencesSchema } from './job-preferences';
import { profileLinksSchema, resumeSchema } from './resume';
import { emptyFormFillDefaults, formFillDefaultsSchema } from './form-fill-defaults';

/**
 * Perfil como a API o devolve. Não é espelho da tabela: `resume`, `links` e
 * `phone` existem no banco e não são expostos aqui. O que a API mostra é uma
 * decisão, não um reflexo do schema do Prisma.
 */
export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  headline: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type Profile = z.infer<typeof profileSchema>;

export const profileListSchema = z.array(profileSchema);

/**
 * O perfil completo, com contato, links e currículo.
 *
 * Schema separado de propósito: `profileSchema` alimenta o seletor de perfil,
 * e mandar o currículo inteiro de todos os perfis só para desenhar três cards
 * seria desperdício — e exporia mais dado pessoal ao cliente do que a tela
 * precisa. Mesma separação que existe entre jobSearchResultSchema e jobSchema.
 */
export const profileDetailSchema = profileSchema.extend({
  email: z.email().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: profileLinksSchema,
  resume: resumeSchema,
  // Com padrão: um backend sem a coluna ainda não derruba a tela de currículo
  // por causa de um campo ausente.
  preferences: jobPreferencesSchema.default(defaultJobPreferences),
  formFillDefaults: formFillDefaultsSchema.default(emptyFormFillDefaults),
  updatedAt: z.iso.datetime(),
});

export type ProfileDetail = z.infer<typeof profileDetailSchema>;

/** Tudo opcional: a tela salva seções isoladas sem reenviar o resto. */
export const updateProfileSchema = z.strictObject({
  name: z.string().trim().min(1, 'Informe um nome').max(80).optional(),
  headline: z.string().trim().max(120).nullable().optional(),
  email: z.email('Email inválido').nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  links: profileLinksSchema.optional(),
  resume: resumeSchema.optional(),
  preferences: jobPreferencesSchema.optional(),
  formFillDefaults: formFillDefaultsSchema.optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Entrada da criação de perfil.
 *
 * `strictObject` e não `object`: o `object` comum descarta campo não declarado
 * em silêncio, então um POST com `isDefault: true` viraria um 201 que ignorou
 * metade do que o cliente mandou. Aqui isso é 400 com "Unrecognized key".
 */
export const createProfileSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Informe um nome')
    .max(80, 'Máximo de 80 caracteres'),
  headline: z.string().trim().max(120, 'Máximo de 120 caracteres').optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
