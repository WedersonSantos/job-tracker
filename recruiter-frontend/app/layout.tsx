import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { Backdrop, MotionProvider } from "@/components/motion";
import { ProfileGate } from "@/features/profile/components/profile-gate";
import {
  getProfiles,
  getSelectedProfile,
} from "@/features/profile/current-profile";
import "./globals.css";

/*
 * Duas famílias, com papéis diferentes. Plus Jakarta Sans no corpo: legível
 * em tamanho pequeno e com mais calor que uma grotesca neutra. Space Grotesk
 * nos títulos e nos números grandes do painel: geométrica, dá presença.
 *
 * `next/font` baixa as fontes no build e serve do próprio app — sem pedido ao
 * Google no navegador e sem o texto piscar de fonte ao carregar.
 */
const body = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const heading = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

const code = Geist_Mono({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JOB TRACKER",
  description: "Rastreador pessoal de candidaturas a vagas.",
};

/**
 * O gate vive no layout, e não numa página: sem perfil escolhido, nenhuma rota
 * tem o que mostrar. Aqui ele guarda todas — inclusive quem abre direto em
 * /vagas/salvas com o cookie vazio.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [profiles, selected] = await Promise.all([
    getProfiles(),
    getSelectedProfile(),
  ]);

  return (
    <html
      lang="pt-BR"
      // `dark` fixo: o tema é escuro sempre, não conforme o sistema.
      className={`dark ${body.variable} ${heading.variable} ${code.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Backdrop />
        <MotionProvider>
          <ProfileGate profiles={profiles} selected={selected}>
            {children}
          </ProfileGate>
        </MotionProvider>
      </body>
    </html>
  );
}
