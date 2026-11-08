import { z } from "zod";

export const demographicOptions = {
  disabilityStatus: ["Sim", "Não", "Prefiro não informar"],
  race: [
    "Branca",
    "Preta",
    "Parda",
    "Amarela",
    "Indígena",
    "Prefiro não informar",
  ],
  sex: ["Feminino", "Masculino", "Intersexo", "Prefiro não informar"],
  genderIdentity: [
    "Mulher",
    "Homem",
    "Mulher cisgênero",
    "Homem cisgênero",
    "Mulher transgênero",
    "Homem transgênero",
    "Travesti",
    "Não binário",
    "Agênero",
    "Outra identidade",
    "Prefiro não informar",
  ],
  sexualOrientation: [
    "Heterossexual",
    "Homossexual",
    "Gay",
    "Lésbica",
    "Bissexual",
    "Pansexual",
    "Assexual",
    "Outra orientação",
    "Prefiro não informar",
  ],
} as const;

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let size = 9; size <= 10; size++) {
    const sum = [...digits.slice(0, size)].reduce(
      (total, digit, index) => total + Number(digit) * (size + 1 - index),
      0,
    );
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(digits[size])) return false;
  }
  return true;
}

export const formFillDefaultsSchema = z.strictObject({
  fullName: z.string().trim().max(160).nullable(),
  cpf: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value) &&
          isValidCpf(value)),
      "Informe um CPF válido",
    )
    .nullable()
    .optional(),
  countryOfOrigin: z.string().trim().max(100).nullable().optional(),
  lastSalary: z.string().trim().max(160).nullable().optional(),
  salaryExpectation: z.string().trim().max(160).nullable(),
  experienceSummary: z.string().trim().max(4000).nullable(),
  presentationBase: z.string().trim().max(2000).nullable().optional(),
  personalizePresentation: z.boolean().optional(),
  disabilityStatus: z
    .enum(demographicOptions.disabilityStatus)
    .nullable()
    .optional(),
  disabilityCid: z.string().trim().max(160).nullable().optional(),
  race: z.enum(demographicOptions.race).nullable().optional(),
  sex: z.enum(demographicOptions.sex).nullable().optional(),
  genderIdentity: z
    .enum(demographicOptions.genderIdentity)
    .nullable()
    .optional(),
  sexualOrientation: z
    .enum(demographicOptions.sexualOrientation)
    .nullable()
    .optional(),
});

export type FormFillDefaults = z.infer<typeof formFillDefaultsSchema>;
export const emptyFormFillDefaults: FormFillDefaults = {
  fullName: null,
  cpf: null,
  countryOfOrigin: null,
  lastSalary: null,
  salaryExpectation: null,
  experienceSummary: null,
  presentationBase: null,
  personalizePresentation: false,
  disabilityStatus: null,
  disabilityCid: null,
  race: null,
  sex: null,
  genderIdentity: null,
  sexualOrientation: null,
};
