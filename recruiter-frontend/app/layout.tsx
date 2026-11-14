import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { Backdrop, MotionProvider } from "@/components/motion";
import { PwaProvider } from "@/features/pwa/pwa-provider";
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
  applicationName: "Job Tracker",
  appleWebApp: { capable: true, title: "Job Tracker", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#141821", width: "device-width", initialScale: 1, viewportFit: "cover" };

/** Public shell; private profile data is loaded only by (workspace)/layout. */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      // `dark` fixo: o tema é escuro sempre, não conforme o sistema.
      className={`dark ${body.variable} ${heading.variable} ${code.variable} h-full antialiased`}
    >
      <body className="min-h-dvh flex flex-col">
        <Backdrop />
        <MotionProvider>
          <PwaProvider>
            {children}
          </PwaProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
