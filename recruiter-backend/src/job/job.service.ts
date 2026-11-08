import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  defaultJobPreferences,
  jobPreferencesSchema,
  resumeSchema,
  type DiscoverResult,
  type DismissJobInput,
  type Job,
  type JobSearchResult,
  type SaveJobInput,
  type SavedJob,
  type UndismissJobInput,
} from '@recruit/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { JobModel } from '../generated/prisma/models';
import { canonicalJobUrl } from './discovery/canonical-url';
import { DiscoveryService } from './discovery/discovery.service';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  /**
   * Descoberta: vagas reais dos portais, ordenadas por aderência ao currículo.
   *
   * Lê o que já é seu para não reoferecer o que você resolveu, e registra o
   * lote devolvido em `DiscoveredJob` — a descoberta é sem estado, então sem
   * essa escrita não existe resposta para "quantas vagas recebi".
   */
  async discover(params: {
    profileId: string;
    cursor?: string;
    q?: string;
    expanded?: boolean;
  }): Promise<DiscoverResult> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: params.profileId },
      select: { resume: true, jobPreferences: true, location: true },
    });

    if (!profile) {
      throw new NotFoundException({
        error: 'Not Found',
        message: 'Perfil não encontrado',
      });
    }

    const resume = resumeSchema.safeParse(profile.resume);
    const preferences = jobPreferencesSchema.safeParse(profile.jobPreferences);

    const result = await this.discoveryService.discover({
      q: params.q,
      expanded: params.expanded,
      skills: resume.success ? resume.data.skills : [],
      profileLocation: profile.location,
      // Preferência corrompida ou ausente cai no padrão em vez de derrubar a
      // busca — mesmo tratamento que `links` e `resume` já recebem.
      preferences: preferences.success
        ? preferences.data
        : defaultJobPreferences,
      excludedUrls: await this.resolvedUrls(params.profileId),
      cursor: params.cursor,
    });

    await this.recordSeen(params.profileId, result.items);

    return result;
  }

  /**
   * Registra que estas vagas foram MOSTRADAS a este perfil.
   *
   * Só o lote devolvido, não o acervo que o leque produziu: as ~2.000 vagas de
   * uma rodada são em maioria filtradas e nunca vistas, e contá-las diria que
   * você recebe duas mil vagas por dia — as mesmas, todo dia.
   *
   * `skipDuplicates` faz disso uma instrução só, sem leitura prévia, e a
   * primeira aparição é a que fica: `firstSeenAt` nunca envelhece para trás.
   *
   * NÃO derruba a descoberta se falhar. Métrica é subproduto; perder uma
   * contagem é aceitável, perder a busca que o usuário pediu não é.
   */
  private async recordSeen(
    profileId: string,
    items: JobSearchResult[],
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    try {
      await this.prisma.discoveredJob.createMany({
        data: toSeenRows(profileId, items),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(
        `não deu para registrar as vagas mostradas: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  /**
   * URLs que este perfil já resolveu, e que não devem voltar na fila.
   *
   * Salvas NÃO bastam: `unsave` apaga só o `SavedJob`, e a `Application`
   * sobrevive (`onDelete: Restrict`). Sem o segundo braço, uma vaga em que
   * você já se candidatou e depois tirou das salvas volta como novidade — o
   * pior erro possível numa tela que promete só mostrar o que você não viu.
   */
  private async resolvedUrls(profileId: string): Promise<Set<string>> {
    const [jobs, dismissed] = await Promise.all([
      this.prisma.job.findMany({
        where: {
          url: { not: null },
          OR: [
            { savedBy: { some: { profileId } } },
            { applications: { some: { profileId, deletedAt: null } } },
          ],
        },
        select: { url: true },
      }),
      this.prisma.dismissedJob.findMany({
        where: { profileId },
        select: { jobUrl: true },
      }),
    ]);

    return new Set([
      ...jobs.map((row) => row.url).filter((url) => url !== null),
      ...dismissed.map((row) => row.jobUrl),
    ]);
  }

  /**
   * Recusa uma vaga. Não volta mais na descoberta deste perfil.
   *
   * Descarte é por perfil, não global: o que não serve para "Backend Sênior"
   * pode servir para "Tech Lead", e a vaga em si continua sem dono (§3).
   */
  async dismiss(input: DismissJobInput): Promise<void> {
    const jobUrl = canonicalJobUrl(input.url);

    if (!jobUrl) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Link inválido.',
      });
    }

    await this.prisma.dismissedJob.upsert({
      where: { profileId_jobUrl: { profileId: input.profileId, jobUrl } },
      create: {
        profileId: input.profileId,
        jobUrl,
        company: input.company,
        title: input.title,
        source: input.source,
      },
      update: {},
    });
  }

  /** Desfaz o descarte — o clique errado numa triagem rápida é comum. */
  async undismiss(input: UndismissJobInput): Promise<void> {
    const jobUrl = canonicalJobUrl(input.url);

    if (!jobUrl) {
      return;
    }

    await this.prisma.dismissedJob.deleteMany({
      where: { profileId: input.profileId, jobUrl },
    });
  }

  async findById(id: string): Promise<Job> {
    const row = await this.prisma.job.findUnique({ where: { id } });

    if (!row) {
      throw new NotFoundException({
        error: 'Not Found',
        message: 'Vaga não encontrada',
      });
    }

    return toJobDto(row);
  }

  /**
   * Materializa o resultado externo. A vaga é deduplicada por `url`: se outro
   * perfil já salvou a mesma, os dois apontam para o mesmo `Job`.
   */
  async save({ profileId, result }: SaveJobInput): Promise<SavedJob> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findUnique({
        where: { id: profileId },
        select: { id: true },
      });

      if (!profile) {
        throw new NotFoundException({
          error: 'Not Found',
          message: 'Perfil não encontrado',
        });
      }

      // Canoniza aqui também, e não só na descoberta: a extração por link
      // devolve a URL que o portal serviu, com rastreamento e sufixo de
      // formulário. Sem isto o mesmo anúncio vira duas linhas em `Job`, e o
      // descarte — que é chaveado por URL — deixa de pegar.
      const url = canonicalJobUrl(result.url) ?? result.url;

      const existing = await tx.job.findUnique({ where: { url } });

      const job =
        existing ??
        (await tx.job.create({
          data: {
            company: result.company,
            title: result.title,
            url,
            source: result.source,
            description: result.description,
            stack: result.stack,
            requirements: result.requirements,
            benefits: result.benefits,
            seniority: result.seniority,
            workModel: result.workModel,
            contractType: result.contractType,
            location: result.location,
            salaryMin: result.salaryMin,
            salaryMax: result.salaryMax,
            salaryCurrency: result.salaryCurrency,
            weeklyHours: result.weeklyHours,
          },
        }));

      // Dá para descartar na busca e salvar a mesma vaga pelo link colado.
      // Sem apagar o descarte aqui, ela ficaria salva e recusada ao mesmo
      // tempo, sumindo de uma tela onde deveria aparecer.
      await tx.dismissedJob.deleteMany({ where: { profileId, jobUrl: url } });

      // Salvar duas vezes não duplica nem falha: o @@unique garante um por par.
      const saved = await tx.savedJob.upsert({
        where: { profileId_jobId: { profileId, jobId: job.id } },
        create: { profileId, jobId: job.id },
        update: {},
      });

      return {
        jobId: job.id,
        savedAt: saved.savedAt.toISOString(),
        job: toJobDto(job),
        application: null,
      };
    });
  }

  /**
   * A candidatura ativa vem junto, na mesma consulta. É ela que decide se a
   * tela mostra "Aplicar" ou "Acompanhar candidatura" — buscar por vaga seria
   * um N+1 para responder a mesma pergunta.
   */
  async listSaved(profileId: string): Promise<SavedJob[]> {
    const rows = await this.prisma.savedJob.findMany({
      where: { profileId },
      orderBy: { savedAt: 'desc' },
      include: {
        job: {
          include: {
            applications: {
              where: { profileId, deletedAt: null },
              select: { id: true, status: true },
              take: 1,
            },
          },
        },
      },
    });

    return rows.map((row) => ({
      jobId: row.jobId,
      savedAt: row.savedAt.toISOString(),
      job: toJobDto(row.job),
      application: row.job.applications[0] ?? null,
    }));
  }

  async unsave(profileId: string, jobId: string): Promise<void> {
    const { count } = await this.prisma.savedJob.deleteMany({
      where: { profileId, jobId },
    });

    if (count === 0) {
      throw new NotFoundException({
        error: 'Not Found',
        message: 'Vaga salva não encontrada',
      });
    }
  }
}

function toJobDto(row: JobModel): Job {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    url: row.url,
    source: row.source,
    description: row.description,
    stack: row.stack,
    requirements: row.requirements,
    benefits: row.benefits,
    seniority: row.seniority,
    workModel: row.workModel,
    contractType: row.contractType,
    location: row.location,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    weeklyHours: row.weeklyHours,
    extractedAt: row.extractedAt ? row.extractedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * As linhas a gravar, separado do service para poder ser testado sem banco.
 *
 * Canoniza a URL aqui, e não confia que a fonte já canonizou: `save()` e
 * `dismiss()` fazem o mesmo, e a identidade tem que ser a mesma nos três —
 * senão a mesma vaga vira duas linhas e o denominador infla para sempre, sem
 * erro nenhum. Hoje todas as fontes canonizam na origem; esta chamada é o que
 * impede que a próxima esqueça.
 */
export function toSeenRows(
  profileId: string,
  items: JobSearchResult[],
): { profileId: string; url: string; source: string }[] {
  const seen = new Set<string>();
  const rows: { profileId: string; url: string; source: string }[] = [];

  for (const job of items) {
    const url = canonicalJobUrl(job.url) ?? job.url;

    // Duas URLs diferentes podem canonizar para a mesma; `createMany` recusaria
    // o lote inteiro por chave duplicada dentro do próprio insert.
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    rows.push({ profileId, url, source: job.source });
  }

  return rows;
}
