import type { ReactNode } from "react";
import { MainNav } from "@/components/layout/main-nav";

interface AppShellProps {
  /** SVG já renderizado no servidor. */
  avatar: string;
  name: string;
  headline: string | null;
  onSwitch: () => void;
  children: ReactNode;
}

/**
 * Casca do app: identidade ativa, navegação e área de conteúdo.
 *
 * Recebe strings, não um `Profile`. É o que a mantém em `components/` sem
 * quebrar a regra: componente que *recebe* dado de domínio continua genérico;
 * o que *busca* dado de domínio pertence a uma feature.
 */
export function AppShell({
  avatar,
  name,
  headline,
  onSwitch,
  children,
}: AppShellProps) {
  return (
    <div data-shell className="flex flex-1 flex-col">
      {/*
        Desktop uses one row; mobile moves the navigation below the identity.
        The application header is omitted from the printed resume.
      */}
      <header
        data-print-hide
        className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/55 backdrop-blur-xl backdrop-saturate-150"
      >
        <div className="mx-auto flex min-h-16 w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 lg:flex-nowrap lg:px-6 lg:py-2">
          <span className="flex shrink-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-zinc-950 shadow-[0_0_24px_-4px] shadow-accent/60"
            >
              JT
            </span>
            <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-tight">
              Job Tracker
            </span>
          </span>

          <MainNav />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span
              aria-hidden
              className="h-8 w-8 overflow-hidden rounded-full ring-1 ring-white/10 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: avatar }}
            />
            <div className="hidden max-w-48 flex-col leading-tight xl:flex">
              <span className="text-sm font-medium">{name}</span>
              {headline && (
                <span className="text-xs text-zinc-400">{headline}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onSwitch}
              className="min-h-11 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium transition hover:border-white/20 hover:bg-white/10"
            >
              Trocar perfil
            </button>
          </div>
        </div>
      </header>

      {/*
        Largura de verdade: antes a maioria das telas parava em ~900 px, e num
        monitor largo mais da metade da tela ficava vazia.
      */}
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
