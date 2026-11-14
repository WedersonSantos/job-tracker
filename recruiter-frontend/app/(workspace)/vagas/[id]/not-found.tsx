import Link from "next/link";

export default function VagaNaoEncontrada() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <h1 className="text-lg font-semibold tracking-tight">
        Vaga não encontrada
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Ela pode ter sido removida, ou o link está errado.
      </p>
      <Link
        href="/vagas/salvas"
        className="text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
      >
        Ver minhas vagas
      </Link>
    </div>
  );
}
