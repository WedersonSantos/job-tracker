import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  defaultJobPreferences,
  emptyLinks,
  emptyResume,
  jobPreferencesSchema,
  profileLinksSchema,
  resumeSchema,
  emptyFormFillDefaults,
  formFillDefaultsSchema,
} from '@recruit/shared';
import type {
  CreateProfileInput,
  JobPreferences,
  Profile,
  ProfileDetail,
  ProfileLinks,
  Resume,
  UpdateProfileInput,
  FormFillDefaults,
} from '@recruit/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ProfileModel } from '../generated/prisma/models';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Perfil padrão primeiro; o resto por ordem de criação. */
  /**
   * `links` e `resume` são Json no banco. Só entram por PATCH validado, então
   * uma forma inesperada aqui significa corrupção ou escrita fora da API —
   * registra e devolve vazio, em vez de derrubar a tela do usuário.
   */
  private parseJson<T>(
    value: unknown,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    fallback: T,
    field: string,
    id: string,
  ): T {
    if (value === null || value === undefined) {
      return fallback;
    }

    const parsed = schema.safeParse(value);

    if (!parsed.success || parsed.data === undefined) {
      this.logger.warn(`Campo ${field} inválido no perfil ${id}; ignorado.`);

      return fallback;
    }

    return parsed.data;
  }

  private toProfileDetailDto(row: ProfileModel): ProfileDetail {
    return {
      ...toProfileDto(row),
      email: row.email,
      phone: row.phone,
      location: row.location,
      links: this.parseJson<ProfileLinks>(
        row.links,
        profileLinksSchema,
        emptyLinks,
        'links',
        row.id,
      ),
      resume: this.parseJson<Resume>(
        row.resume,
        resumeSchema,
        emptyResume,
        'resume',
        row.id,
      ),
      preferences: this.parseJson<JobPreferences>(
        row.jobPreferences,
        jobPreferencesSchema,
        defaultJobPreferences,
        'jobPreferences',
        row.id,
      ),
      updatedAt: row.updatedAt.toISOString(),
      formFillDefaults: this.parseJson<FormFillDefaults>(
        row.formFillDefaults,
        formFillDefaultsSchema,
        emptyFormFillDefaults,
        'formFillDefaults',
        row.id,
      ),
    };
  }

  async list(): Promise<Profile[]> {
    const rows = await this.prisma.profile.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map(toProfileDto);
  }

  /** Usado pelo ProfileExistsPipe para conferir id vindo do cliente. */
  async findById(id: string): Promise<Profile | null> {
    const row = await this.prisma.profile.findUnique({ where: { id } });

    return row ? toProfileDto(row) : null;
  }

  /** Perfil completo, com contato, links e currículo. */
  async findDetailById(id: string): Promise<ProfileDetail> {
    const row = await this.prisma.profile.findUnique({ where: { id } });

    if (!row) {
      throw new NotFoundException({
        error: 'Not Found',
        message: 'Perfil não encontrado',
      });
    }

    return this.toProfileDetailDto(row);
  }

  async update(id: string, input: UpdateProfileInput): Promise<ProfileDetail> {
    const exists = await this.prisma.profile.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException({
        error: 'Not Found',
        message: 'Perfil não encontrado',
      });
    }

    const row = await this.prisma.profile.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.headline !== undefined && { headline: input.headline }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.links !== undefined && { links: input.links }),
        ...(input.resume !== undefined && { resume: input.resume }),
        ...(input.formFillDefaults !== undefined && {
          formFillDefaults: input.formFillDefaults,
        }),
        ...(input.preferences !== undefined && {
          jobPreferences: input.preferences,
        }),
      },
    });

    return this.toProfileDetailDto(row);
  }

  async create(input: CreateProfileInput): Promise<Profile> {
    // O primeiro perfil do banco nasce como padrão — senão o app abriria
    // sem nenhum perfil pré-selecionado.
    const isFirst = (await this.prisma.profile.count()) === 0;

    const row = await this.prisma.profile.create({
      data: {
        name: input.name,
        headline: input.headline ?? null,
        isDefault: isFirst,
      },
    });

    return toProfileDto(row);
  }
}

/**
 * Fronteira entre a tabela e a API. `resume`, `links`, `phone` e `email`
 * existem na linha e não são expostos aqui: esta é a forma que alimenta o
 * seletor de perfil, e mandar o currículo de todos só para desenhar cards
 * seria desperdício. A leitura completa é `findDetailById`.
 */
function toProfileDto(row: ProfileModel): Profile {
  return {
    id: row.id,
    name: row.name,
    headline: row.headline,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}
