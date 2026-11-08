"use server";
import { revalidatePath } from "next/cache";
import {
  MAX_RESUME_PDF_BYTES,
  type ResumeFileInfo,
  type ResumeImport,
} from "@recruit/shared";
import {
  ApiError,
  removeResumeFile,
  uploadResumeFile,
  importResumeFile,
  getResumeFile,
} from "./api";

export type ResumeFileState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      file: ResumeFileInfo | null;
      imported?: ResumeImport;
      warning?: string;
    };

export async function saveResumeFileAction(
  id: string,
  _previous: ResumeFileState,
  data: FormData,
): Promise<ResumeFileState> {
  try {
    if (data.get("operation") === "remove") {
      await removeResumeFile(id);
      revalidatePath("/curriculo");
      return {
        status: "success",
        message: "PDF removido deste perfil.",
        file: null,
      };
    }
    const readSaved = data.get("operation") === "import";
    const file = data.get("resumePdf");
    if (
      !readSaved &&
      (!(file instanceof File) ||
        !file.size ||
        file.size > MAX_RESUME_PDF_BYTES ||
        !file.name.toLowerCase().endsWith(".pdf"))
    )
      return {
        status: "error",
        message: "Selecione um currículo em PDF de até 5 MB.",
      };
    const saved = readSaved
      ? await getResumeFile(id)
      : await uploadResumeFile(id, {
          fileName: (file as File).name,
          content: Buffer.from(await (file as File).arrayBuffer()).toString(
            "base64",
          ),
        });
    if (!saved)
      return {
        status: "error",
        message: "Guarde um PDF neste perfil primeiro.",
      };
    revalidatePath("/curriculo");
    try {
      const imported = await importResumeFile(id);
      return {
        status: "success",
        message:
          "PDF lido. Os dados reconhecidos preenchem os campos vazios abaixo. Revise e clique em Salvar para gravar o currículo.",
        file: saved,
        imported,
      };
    } catch (error) {
      return {
        status: "success",
        message: "PDF salvo para anexar nas candidaturas.",
        file: saved,
        warning:
          error instanceof ApiError
            ? error.message
            : "Não consegui ler os dados do PDF. Preencha os campos manualmente; o anexo continua salvo.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Não consegui guardar o PDF. Tente novamente.",
    };
  }
}
