import Link from "next/link";
import { getWebConfig } from "@/lib/web-access-store";
import { safeReturnPath } from "@/lib/web-access-core";
import { LoginForm } from "@/features/web-access/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const configured = Boolean(getWebConfig());
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
    <span aria-hidden className="mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-xl font-bold text-zinc-950">JT</span>
    <p className="text-sm font-medium text-accent-2">JOB TRACKER</p>
    <h1 className="mt-3 text-3xl font-semibold">Seu próximo passo começa aqui.</h1>
    <p className="mt-4 leading-7 text-zinc-300">Entre para acessar seu currículo e acompanhar suas candidaturas.</p>
    {configured ? <LoginForm next={safeReturnPath((await searchParams).next)} error={(await searchParams).error} /> : <Link className="mt-8 flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 font-semibold text-zinc-950" href="/">Abrir aplicativo local</Link>}
  </main>;
}
