"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  IconBriefcase,
  IconChart,
  IconDocument,
  IconList,
  IconMail,
  IconInstall,
} from "@/components/icons";

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Ausente = sem tela ainda: fica visível e desabilitado. */
  href?: string;
}

/** Main application sections, including device installation and access. */
const items: NavItem[] = [
  { id: "candidaturas", label: "Candidaturas", icon: <IconList />, href: "/" },
  { id: "vagas", label: "Vagas", icon: <IconBriefcase />, href: "/vagas" },
  { id: "curriculo", label: "Currículo", icon: <IconDocument />, href: "/curriculo" },
  { id: "emails", label: "Emails", icon: <IconMail />, href: "/emails" },
  { id: "metricas", label: "Métricas", icon: <IconChart />, href: "/metricas" },
  { id: "instalar", label: "Instalar", icon: <IconInstall />, href: "/instalar" },
];

/** "/" só casa exato; as demais casam com as subrotas (/vagas/salvas, /vagas/x). */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções" className="order-3 w-full min-w-0 pb-2 lg:order-none lg:w-auto lg:pb-0">
      <ul className="flex items-center justify-between gap-1 overflow-x-auto lg:justify-start">
        {items.map((item) => {
          const active = item.href ? isActive(pathname, item.href) : false;
          const className = `group relative flex min-h-12 flex-col justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-medium transition-colors duration-200 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${
            item.href
              ? active
                ? "text-zinc-50"
                : "text-zinc-400 hover:text-zinc-100"
              : "cursor-not-allowed text-zinc-600"
          }`;

          const content = (
            <>
              {active && <ActivePill />}
              <span className="relative transition-transform duration-200 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                {item.icon}
              </span>
              <span className="relative">{item.label}</span>
            </>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`cursor-pointer ${className}`}
                >
                  {content}
                </Link>
              ) : (
                <button type="button" disabled title="Em breve" className={className}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * O fundo do item ativo, que DESLIZA até o próximo quando você troca de tela.
 *
 * `layoutId` é o que faz isso: o Motion reconhece que é o "mesmo" elemento em
 * dois lugares do layout e anima a posição e o tamanho entre eles, por mola.
 * Sem ele o fundo sumiria de um item e reapareceria no outro, sem viagem.
 *
 * Funciona entre páginas porque o cabeçalho vive no layout, que não remonta
 * na navegação — o elemento sobrevive à troca de rota.
 */
function ActivePill() {
  return (
    <motion.span
      layoutId="nav-active"
      aria-hidden
      className="absolute inset-0 rounded-lg border border-white/10 bg-gradient-to-b from-white/12 to-white/4 shadow-[0_0_20px_-6px] shadow-accent/70"
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    />
  );
}
