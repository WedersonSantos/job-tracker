import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateWebConfig, type WebAccessConfig } from "./web-access-core";

function file() { return process.env.JOBTRACKER_WEB_CONFIG || join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "job-tracker", "web-access.json"); }
export function getWebConfig(): WebAccessConfig | null {
  const target = file();
  // Runtime owner config must never be traced into a distributable Next build.
  if (!existsSync(/* turbopackIgnore: true */ target)) return null;
  const data = readFileSync(/* turbopackIgnore: true */ target, "utf8");
  if (data.length > 4096) throw new Error("Configuração de acesso web inválida.");
  return validateWebConfig(JSON.parse(data));
}
export async function saveWebConfig(config: WebAccessConfig) {
  const target = file(), temp = target + "." + randomUUID() + ".tmp";
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try { await writeFile(temp, JSON.stringify(validateWebConfig(config)), { mode: 0o600 }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
}
export async function removeWebConfig() { await rm(file(), { force: true }); }
