import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  resumeSchema,
  profileLinksSchema,
  formFillDefaultsSchema,
} from '@recruit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ResumeFileService } from '../profile/resume-file.service';
import { assertReachable } from '../job/safe-fetch';
import { buildFieldPlan, NEVER_FILL, type PlannedField } from './field-plan';
import {
  chromeProfiles,
  lastUsedChromeProfile,
  openChromeProfile,
} from './chrome-profiles';
import {
  APPLICATION_ACTION_LABEL,
  GOOGLE_LOGIN_LABEL,
} from './application-navigation';

const TTL = 10 * 60_000;
export function serializePlan(plan: PlannedField[]) {
  return plan.map((f) => ({
    what: f.what,
    value: f.value,
    labels: f.labels.source,
    flags: f.labels.flags,
    names: f.names?.source,
    autocomplete: f.autocomplete,
    ...(f.sensitive ? { sensitive: true } : {}),
  }));
}
@Injectable()
export class NativeChromeService {
  private pending = new Map<
    string,
    { expires: number; profileId: string; name: string; url: string }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeFiles: ResumeFileService,
  ) {}
  profiles() {
    return chromeProfiles();
  }
  private prune() {
    for (const [id, p] of this.pending)
      if (p.expires < Date.now()) this.pending.delete(id);
  }
  async open(
    profileId: string,
    chromeProfile: string | undefined,
    rawUrl: string,
    prepareOnly = false,
  ) {
    const url = new URL(rawUrl);
    await assertReachable(url);
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { name: true },
    });
    if (!profile) throw new NotFoundException('Perfil não encontrado.');
    let selected = chromeProfile;
    if (!selected && !prepareOnly) {
      const available = await this.profiles();
      const lastUsed = await lastUsedChromeProfile();
      selected = (
        available.find((item) => item.id === lastUsed) ?? available[0]
      )?.id;
      if (!selected)
        throw new BadRequestException(
          'Nenhum perfil do Chrome encontrado. Abra o Chrome e configure um perfil para continuar.',
        );
    }
    this.prune();
    const existing = [...this.pending].find(
      ([, item]) => item.profileId === profileId && item.url === url.href,
    );
    const oldest = [...this.pending.keys()][0];
    if (!existing && this.pending.size >= 10 && oldest)
      this.pending.delete(oldest);
    const id = existing?.[0] ?? randomUUID();
    this.pending.set(id, {
      profileId,
      name: profile.name,
      url: url.href,
      expires: Date.now() + TTL,
    });
    if (!prepareOnly) {
      // The extension resolves the destination and focuses an existing application
      // tab. Never launch the job URL directly: Chrome always creates a duplicate.
      await openChromeProfile(
        selected!,
        `http://127.0.0.1:3333/form-fill/chrome/open?requestId=${id}`,
      );
    }
    return {
      requestId: id,
      message:
        'Vaga aberta no Chrome. Use a extensão Job Tracker para preencher a candidatura e revise antes de enviar.',
    };
  }
  requests() {
    this.prune();
    return [...this.pending].map(([id, p]) => ({
      id,
      name: p.name,
      url: p.url,
    }));
  }
  requestContext(id: string) {
    this.prune();
    const pending = this.pending.get(id);
    if (!pending)
      throw new BadRequestException(
        'Pedido expirou. Abra a vaga novamente pelo aplicativo.',
      );
    pending.expires = Date.now() + TTL;
    return { profileId: pending.profileId, url: pending.url };
  }
  async validateTarget(target: string) {
    const url = new URL(target);
    if (url.protocol !== 'https:')
      throw new BadRequestException('Abra uma página HTTPS da vaga.');
    await assertReachable(url);
    return { url: url.href };
  }
  async plan(id: string, target: string) {
    this.prune();
    const pending = this.pending.get(id);
    if (!pending)
      throw new BadRequestException(
        'Pedido expirou. Abra a vaga novamente pelo aplicativo.',
      );
    const url = new URL(target);
    if (url.protocol !== 'https:')
      throw new BadRequestException('Abra o formulário HTTPS da empresa.');
    await assertReachable(url);
    const p = await this.prisma.profile.findUnique({
      where: { id: pending.profileId },
      select: {
        name: true,
        email: true,
        phone: true,
        location: true,
        links: true,
        resume: true,
        formFillDefaults: true,
      },
    });
    if (!p) throw new NotFoundException('Perfil não encontrado.');
    const links = profileLinksSchema.safeParse(p.links),
      resume = resumeSchema.safeParse(p.resume),
      defaults = formFillDefaultsSchema.safeParse(p.formFillDefaults);
    const plan = buildFieldPlan({
      ...p,
      links: links.success ? links.data : null,
      resume: resume.success ? resume.data : null,
      defaults: defaults.success ? defaults.data : null,
    });
    pending.expires = Date.now() + TTL;
    const attachment = await this.resumeFiles.attachment(pending.profileId);
    return {
      fields: serializePlan(plan),
      presentation: {
        enabled:
          defaults.success && defaults.data.personalizePresentation === true,
      },
      facts: { skills: resume.success ? resume.data.skills : [] },
      navigation: {
        apply: APPLICATION_ACTION_LABEL.source,
        google: GOOGLE_LOGIN_LABEL.source,
        maxSteps: 4,
      },
      blocked: NEVER_FILL.source,
      attachment: attachment
        ? {
            fileName: attachment.name,
            base64: attachment.buffer.toString('base64'),
          }
        : null,
    };
  }
}
