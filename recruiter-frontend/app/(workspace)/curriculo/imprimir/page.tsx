import Link from "next/link";
import { emptyLinks, emptyResume } from "@recruit/shared";
import { getProfileDetail } from "@/features/profile/api";
import { getSelectedProfile } from "@/features/profile/current-profile";
import { PrintButton, ResumeSheet } from "@/features/resume";

export default async function ImprimirCurriculoPage() {
  const selected = await getSelectedProfile();

  if (!selected) {
    return null;
  }

  const profile = await getProfileDetail(selected.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">
            Currículo para impressão
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Escolha &quot;Salvar como PDF&quot; no destino da impressão.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/curriculo"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Editar
          </Link>
          <PrintButton />
        </div>
      </header>

      {/* Fundo claro fixo: a folha é a folha, e um currículo em tema escuro
          sairia com o fundo em branco e o texto quase invisível na impressão. */}
      <div className="rounded-xl border border-zinc-200 bg-white print:rounded-none print:border-0">
        <ResumeSheet
          name={profile.name}
          headline={profile.headline}
          email={profile.email}
          phone={profile.phone}
          location={profile.location}
          links={profile.links ?? emptyLinks}
          resume={profile.resume ?? emptyResume}
        />
      </div>
    </div>
  );
}
