"use server";
import {
  sourceSettingsSchema,
  type SourceOverview,
  type SourceSettings,
} from "@recruit/shared";
import { revalidatePath } from "next/cache";
import { ApiError, checkSources, saveSourceSettings } from "./api";

type Outcome =
  | { status: "success"; overview: SourceOverview; message: string }
  | { status: "error"; message: string };
export async function saveSourcesAction(
  settings: SourceSettings,
): Promise<Outcome> {
  const parsed = sourceSettingsSchema.safeParse(settings);
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" · "),
    };
  try {
    const overview = await saveSourceSettings(parsed.data);
    revalidatePath("/vagas/fontes");
    return {
      status: "success",
      overview,
      message:
        "Murais validados e salvos. As próximas buscas já usarão esta lista.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Não consegui salvar os murais. Verifique se a API está funcionando.",
    };
  }
}
export async function checkSourcesAction(): Promise<Outcome> {
  try {
    return {
      status: "success",
      overview: await checkSources(),
      message:
        "Consulta de teste concluída. Confira o resultado de cada fonte abaixo.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Não consegui testar as fontes. Tente novamente.",
    };
  }
}
