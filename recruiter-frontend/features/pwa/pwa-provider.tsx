"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaState {
  installed: boolean; ios: boolean; secure: boolean; ready: boolean;
  canInstall: boolean; install(): Promise<void>; message: string;
}
const Context = createContext<PwaState | null>(null);
function subscribeDevice(notify: () => void) {
  const standalone = window.matchMedia("(display-mode: standalone)");
  standalone.addEventListener("change", notify);
  window.addEventListener("online", notify); window.addEventListener("offline", notify);
  return () => { standalone.removeEventListener("change", notify); window.removeEventListener("online", notify); window.removeEventListener("offline", notify); };
}
function deviceSnapshot() {
  const installed = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return [installed, ios, window.isSecureContext, navigator.onLine].map(value => value ? "1" : "0").join("");
}
const serverSnapshot = () => "";
export function usePwa() {
  const value = useContext(Context);
  if (!value) throw Error("PwaProvider ausente");
  return value;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const device = useSyncExternalStore(subscribeDevice, deviceSnapshot, serverSnapshot);
  const [justInstalled, setInstalled] = useState(false);
  const installed = justInstalled || device[0] === "1", ios = device[1] === "1", secure = device[2] === "1", ready = Boolean(device), online = !ready || device[3] === "1";
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [message, setMessage] = useState("");
  const updating = useRef(false);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const completed = () => { setInstalled(true); setPrompt(null); setMessage("Job Tracker instalado."); };
    window.addEventListener("beforeinstallprompt", capture); window.addEventListener("appinstalled", completed);
    let disposed = false;
    const controllerChanged = () => { if (updating.current) window.location.reload(); };
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(registration => {
        if (disposed) return;
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (!disposed && worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(registration.waiting);
          });
        });
      }).catch(() => { if (!disposed) setMessage("A instalação offline não ficou pronta. Recarregue a página para tentar novamente."); });
    }
    return () => {
      disposed = true;
      window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", completed);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      setMessage(result.outcome === "accepted" ? "Instalação solicitada ao navegador." : "Você pode instalar depois pelo menu do navegador.");
    } catch { setMessage("Use a opção Instalar aplicativo no menu do navegador."); }
    setPrompt(null);
  }
  return <Context.Provider value={{ installed, ios, secure, ready, canInstall: Boolean(prompt), install, message }}>
    {!online && <div role="status" className="border-b border-amber-300/20 bg-zinc-900 px-4 py-3 text-center text-sm text-amber-200">Sem conexão. Os dados precisam do servidor online.</div>}
    {waiting && <div role="status" className="flex flex-wrap items-center justify-center gap-3 border-b border-white/10 bg-zinc-900 px-4 py-3 text-sm">
      <span>Nova versão disponível. Salve suas alterações antes de atualizar.</span>
      <button type="button" className="min-h-11 rounded-lg border border-white/20 px-4 font-semibold" onClick={() => { updating.current = true; waiting.postMessage({ type: "SKIP_WAITING" }); }}>Atualizar app</button>
    </div>}
    {children}
  </Context.Provider>;
}
