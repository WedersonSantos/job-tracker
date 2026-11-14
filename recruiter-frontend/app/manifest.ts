import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Job Tracker", short_name: "Job Tracker",
    description: "Seu currículo, suas vagas e suas candidaturas em um só lugar.",
    start_url: "/", scope: "/", display: "standalone", lang: "pt-BR",
    background_color: "#141821", theme_color: "#141821",
    icons: [
      { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
