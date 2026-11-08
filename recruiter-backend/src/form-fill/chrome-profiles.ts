import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { BadRequestException } from '@nestjs/common';

export interface ChromeProfile {
  id: string;
  name: string;
}
export function parseLastUsedChromeProfile(raw: string): string | undefined {
  const data: unknown = JSON.parse(raw);
  const id = (data as { profile?: { last_used?: unknown } })?.profile
    ?.last_used;
  if (typeof id !== 'string' || !/^(Default|Profile \d+)$/.test(id))
    return undefined;
  // Ignore stale metadata referring to a profile that no longer exists.
  return parseChromeProfiles(raw).some((profile) => profile.id === id)
    ? id
    : undefined;
}
async function chromeLocalState(): Promise<string | undefined> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA)
    return undefined;
  try {
    return await readFile(
      join(
        process.env.LOCALAPPDATA,
        'Google',
        'Chrome',
        'User Data',
        'Local State',
      ),
      'utf8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function lastUsedChromeProfile(): Promise<string | undefined> {
  const raw = await chromeLocalState();
  return raw === undefined ? undefined : parseLastUsedChromeProfile(raw);
}
export function parseChromeProfiles(raw: string): ChromeProfile[] {
  const data: unknown = JSON.parse(raw);
  const cache = (
    data as { profile?: { info_cache?: Record<string, { name?: unknown }> } }
  )?.profile?.info_cache;
  if (!cache || typeof cache !== 'object') return [];
  return Object.entries(cache)
    .filter(([id]) => /^(Default|Profile \d+)$/.test(id))
    .map(([id, p]) => ({
      id,
      name: typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : id,
    }));
}
export async function chromeProfiles(): Promise<ChromeProfile[]> {
  const raw = await chromeLocalState();
  return raw === undefined ? [] : parseChromeProfiles(raw);
}
export async function openChromeProfile(id: string, url: string) {
  if (!(await chromeProfiles()).some((p) => p.id === id))
    throw new BadRequestException('Escolha um perfil do Chrome disponível.');
  const candidates = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ]
    .filter((p): p is string => !!p)
    .map((p) => join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  let executable: string | undefined;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {
      /* next standard installation */
    }
  }
  if (!executable)
    throw new BadRequestException(
      'Google Chrome não encontrado nesta máquina.',
    );
  // Normal Chrome launch: no debugging, no cookie copying, no shell interpolation.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [`--profile-directory=${id}`, url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
