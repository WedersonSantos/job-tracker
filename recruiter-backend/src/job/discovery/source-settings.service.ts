import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  sourceSettingsSchema,
  ashbyBoardReference,
  leverBoardReference,
  type SourceSettings,
} from '@recruit/shared';
import { loadDepartmentNames } from './ashby-department';
import type { Env } from '../../config/env';
import { fetchPublicJson } from '../safe-fetch';
import { watchlistFrom } from './watchlist';

@Injectable()
export class SourceSettingsService {
  constructor(private readonly config: ConfigService<Env, true>) {}
  private file() {
    return join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'job-tracker',
      'discovery-sources.json',
    );
  }
  async read(): Promise<SourceSettings> {
    try {
      return sourceSettingsSchema.parse(
        JSON.parse(await readFile(this.file(), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return sourceSettingsSchema.parse(watchlistFrom(this.config));
      throw error;
    }
  }
  emailSetup() {
    const keys = ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD'] as const;
    const missingFields = keys.filter(
      (key) => !this.config.get(key, { infer: true }),
    );
    return {
      configured: missingFields.length === 0,
      missingFields,
      mailbox: this.config.get('IMAP_MAILBOX', { infer: true }),
    };
  }
  async save(input: SourceSettings): Promise<SourceSettings> {
    const settings = sourceSettingsSchema.parse(input);
    const checks = await Promise.all(
      Object.entries(settings).flatMap(([kind, slugs]) =>
        slugs.map(async (slug) => {
          const ashby = kind === 'ashby' ? ashbyBoardReference(slug) : null;
          const lever = kind === 'lever' ? leverBoardReference(slug) : null;
          const endpoint =
            kind === 'greenhouse'
              ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
              : kind === 'ashby'
                ? `https://api.ashbyhq.com/posting-api/job-board/${ashby!.slug}`
                : `https://api.lever.co/v0/postings/${lever!.slug}?mode=json`;
          try {
            const payload = await fetchPublicJson(endpoint);
            if (
              kind === 'lever'
                ? !Array.isArray(payload)
                : !payload ||
                  typeof payload !== 'object' ||
                  !Array.isArray((payload as { jobs?: unknown }).jobs)
            )
              throw Error('resposta sem lista de vagas');
            if (ashby?.departmentId)
              await loadDepartmentNames(ashby.slug, ashby.departmentId);
            if (
              lever?.team &&
              !(payload as { categories?: { team?: unknown } }[]).some(
                (job) =>
                  typeof job.categories?.team === 'string' &&
                  job.categories.team.trim().toLowerCase() ===
                    lever.team!.toLowerCase(),
              )
            )
              throw new Error(
                'A equipe selecionada não foi encontrada entre as vagas deste mural.',
              );
            return null;
          } catch (error) {
            return `${kind}/${slug}: ${error instanceof Error ? error.message : 'não foi possível validar o mural'}`;
          }
        }),
      ),
    );
    const errors = checks.filter(Boolean);
    if (errors.length)
      throw new BadRequestException({
        message: `Não salvei as alterações. Confira estes murais: ${errors.join(' · ')}`,
      });
    const file = this.file();
    await mkdir(join(file, '..'), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(settings), { mode: 0o600 });
      await rename(tmp, file);
    } finally {
      await rm(tmp, { force: true });
    }
    return settings;
  }
}
