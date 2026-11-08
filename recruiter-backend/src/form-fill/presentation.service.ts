import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { formFillDefaultsSchema } from '@recruit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AnswersService } from '../answers/answers.service';
import { NativeChromeService } from './native-chrome.service';

type DraftState =
  | { status: 'pending' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string };
@Injectable()
export class PresentationService {
  private drafts = new Map<string, { expires: number; state: DraftState }>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly nativeChrome: NativeChromeService,
    private readonly answers: AnswersService,
  ) {}
  async draft(
    requestId: string,
    target: string,
    maxChars: number,
  ): Promise<DraftState> {
    const context = this.nativeChrome.requestContext(requestId);
    await this.nativeChrome.validateTarget(target);
    if (!/(^|\.)gupy\.io$/i.test(new URL(target).hostname))
      throw new BadRequestException(
        'A apresentação automática está disponível na etapa Apresente-se da Gupy.',
      );
    const [profile, job] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: context.profileId },
        select: { formFillDefaults: true, updatedAt: true },
      }),
      this.prisma.job.findUnique({
        where: { url: context.url },
        select: {
          id: true,
          company: true,
          title: true,
          description: true,
          stack: true,
          requirements: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!profile) throw new NotFoundException('Currículo não encontrado.');
    const defaults = formFillDefaultsSchema.safeParse(profile.formFillDefaults);
    if (!defaults.success || !defaults.data.personalizePresentation)
      throw new BadRequestException(
        'Ative a apresentação personalizada no currículo e salve.',
      );
    if (
      !job ||
      (!job.description?.trim() &&
        !job.stack.length &&
        !job.requirements.length)
    )
      throw new BadRequestException(
        'Salve a descrição da vaga no aplicativo antes de gerar a apresentação.',
      );
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          context.profileId,
          profile.updatedAt,
          job.id,
          job.updatedAt,
          maxChars,
        ]),
      )
      .digest('hex');
    for (const [id, entry] of this.drafts)
      if (entry.expires <= Date.now()) this.drafts.delete(id);
    const cached = this.drafts.get(key);
    if (cached) return cached.state;
    const oldest = [...this.drafts.keys()][0];
    if (this.drafts.size >= 30 && oldest !== undefined)
      this.drafts.delete(oldest);
    const entry: { expires: number; state: DraftState } = {
      expires: Date.now() + 10 * 60_000,
      state: { status: 'pending' },
    };
    this.drafts.set(key, entry);
    // Respond immediately. The extension polls; a slow AI call must not time out
    // the MV3 worker's fetch or start another paid generation on every poll.
    void this.answers
      .draft({
        profileId: context.profileId,
        jobId: job.id,
        question:
          'Apresente-se! Fale sobre você e sua trajetória profissional, contando como pode ajudar a empresa no desafio descrito na vaga. Relacione fatos do currículo aos requisitos da vaga e mencione a empresa e o cargo quando fizer sentido. Use palavras-chave somente quando sustentadas pelo currículo; não invente qualificações nem elogios à empresa.',
        notes: defaults.data.presentationBase?.trim() || undefined,
        language: 'pt',
        mode: 'draft',
        maxChars,
      })
      .then((answer) => {
        const text = answer.draft?.trim();
        if (
          !text ||
          text.length > maxChars ||
          answer.overLimit ||
          !answer.facts.length ||
          answer.facts.some((fact) => !fact.grounded) ||
          answer.unverifiedNumbers.length
        ) {
          entry.state = {
            status: 'error',
            message:
              'A apresentação precisa de revisão: o rascunho ultrapassou o limite ou contém afirmações sem confirmação no currículo. Preencha esse campo manualmente.',
          };
          return;
        }
        entry.state = { status: 'ready', text };
      })
      .catch((error: unknown) => {
        entry.expires = Date.now() + 30_000;
        entry.state = {
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Não consegui gerar a apresentação. Preencha manualmente.',
        };
      });
    return entry.state;
  }
}
