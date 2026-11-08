import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  resumeSchema,
  profileLinksSchema,
  formFillDefaultsSchema,
} from '@recruit/shared';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { assertReachable, FetchError } from '../job/safe-fetch';
import { PrismaService } from '../prisma/prisma.service';
import { buildFieldPlan, type PlannedField } from './field-plan';
import { locateField } from './field-locator';
import {
  ResumeFileService,
  type ResumeAttachment,
} from '../profile/resume-file.service';
import { attachResume, type AttachmentReport } from './resume-upload';
import {
  findApplicationPage,
  guardApplicationNavigation,
} from './application-navigation';

/**
 * Preenchimento assistido de formulário de candidatura.
 *
 * A funcionalidade 6 do §1, e a regra que a define está no §5, em maiúsculas
 * no espírito: **nunca submeter**. Preenche, para, e espera você revisar.
 *
 * Isso não é excesso de zelo. Candidatura enviada não tem desfazer — você não
 * "descandidata", e uma aplicação ruim queima aquela empresa. E as perguntas
 * que decidem são as abertas, que este código se recusa a responder.
 *
 * Medido antes de escrever: o formulário da Ashby tem reCAPTCHA. Mesmo que
 * alguém quisesse automatizar o envio, não daria — parar antes é a única
 * forma coerente, não um enfeite ético.
 *
 * Navegador VISÍVEL e perfil persistente. Visível porque você precisa ver o
 * que foi preenchido antes de enviar; persistente porque ATS como Gupy exigem
 * conta, e sem sessão guardada cada rodada recomeçaria no login.
 */

/**
 * Onde fica o perfil do Chrome — FORA da pasta do projeto.
 *
 * Ele guarda cookies de sessão logada dos ATS. Estar no `.gitignore` impedia
 * o commit, mas não impedia o resto: zipar o projeto, copiar para outra
 * máquina, mandar para alguém depurar, sincronizar a pasta num drive. Qualquer
 * um desses levaria as sessões junto. No diretório de dados do usuário, o
 * projeto pode ir para onde for sem arrastar credencial.
 */
const PROFILE_DIR = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
  'job-tracker',
  'browser-profile',
);

const NAV_TIMEOUT_MS = 45_000;
const FIELD_TIMEOUT_MS = 2_500;

export interface FillReport {
  url: string;
  filled: { what: string; value: string }[];
  skipped: string[];
  message?: string;
  attachment?: AttachmentReport;
  /** Sempre `false`. Existe para o contrato afirmar o que o código faz. */
  submitted: false;
}

@Injectable()
export class FormFillService {
  private readonly logger = new Logger(FormFillService.name);

  /** Uma rodada por vez: duas ao mesmo tempo disputariam a mesma janela. */
  private running = false;

  /**
   * A janela, reaproveitada entre chamadas.
   *
   * Isto não é cache por desempenho, é necessidade: a janela fica ABERTA de
   * propósito para você revisar, e enquanto está aberta o Chrome mantém o
   * diretório de perfil travado. Um segundo `launchPersistentContext` no mesmo
   * diretório não abre — sai na hora e leva o contexto junto. Foi exatamente o
   * que aconteceu na primeira execução pela API.
   *
   * Cada vaga vira uma ABA na mesma janela, que também é a forma certa de usar.
   */
  private context: BrowserContext | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeFiles: ResumeFileService,
  ) {}

  async fill(profileId: string, rawUrl: string): Promise<FillReport> {
    const url = navigableUrl(rawUrl);

    if (!url) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Link inválido.',
      });
    }

    // O navegador aqui tem SESSÃO LOGADA nos ATS, então navegar para qualquer
    // lugar é mais perigoso que um fetch comum. As URLs vêm de portais de
    // terceiros; uma apontando para 127.0.0.1 ou para a rede interna abriria,
    // com seus cookies, o painel do roteador ou um serviço local.
    //
    // Mesma regra do `safe-fetch`: loopback, rede privada, link-local e
    // metadados de nuvem, conferindo TODO endereço que o host resolve.
    try {
      await assertReachable(new URL(url));
    } catch (error) {
      throw new BadRequestException({
        error: 'Bad Request',
        message:
          error instanceof FetchError
            ? error.message
            : 'Endereço não permitido.',
      });
    }

    if (this.running) {
      throw new ServiceUnavailableException({
        error: 'Service Unavailable',
        message: 'Já existe um preenchimento em andamento.',
      });
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
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

    if (!profile) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Perfil não encontrado.',
      });
    }

    const links = profileLinksSchema.safeParse(profile.links);
    const resume = resumeSchema.safeParse(profile.resume);
    const defaults = formFillDefaultsSchema.safeParse(profile.formFillDefaults);

    const plan = buildFieldPlan({
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      links: links.success ? links.data : null,
      resume: resume.success ? resume.data : null,
      defaults: defaults.success ? defaults.data : null,
    });

    if (plan.length === 0) {
      throw new BadRequestException({
        error: 'Bad Request',
        message:
          'Nada a preencher: complete nome, email ou telefone no seu perfil.',
      });
    }

    this.running = true;

    try {
      return await this.run(
        url,
        plan,
        await this.resumeFiles.attachment(profileId),
      );
    } finally {
      this.running = false;
    }
  }

  private async run(
    url: string,
    plan: PlannedField[],
    file: ResumeAttachment | null,
  ): Promise<FillReport> {
    const context = await this.window();

    // Aba NOVA, sem reaproveitar a inicial: a página que o contexto persistente
    // abre sozinho pode ser substituída no meio da navegação, e o `goto` morre
    // com `ERR_ABORTED; maybe frame was detached`.
    let page = await context.newPage();
    const removeGuard = await guardApplicationNavigation(context);

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      const destination = await findApplicationPage(page);
      page = destination.page;
      const report: FillReport = destination.message
        ? {
            url: page.url(),
            filled: [],
            skipped: plan.map((item) => item.what),
            submitted: false,
            message: destination.message,
          }
        : await this.apply(page, plan, page.url());
      if (file && !destination.message)
        report.attachment = await attachResume(page, file);

      this.logger.log(
        `preenchido ${report.filled.length}/${plan.length} em ${url} — NÃO enviado`,
      );

      // A janela fica ABERTA de propósito: é onde você revisa e envia. Fechar
      // o contexto aqui apagaria o trabalho.
      return report;
    } catch (error) {
      // Fecha só a ABA. Fechar a janela levaria junto o trabalho de outra vaga
      // que você ainda não enviou.
      await page.close().catch(() => undefined);

      throw new ServiceUnavailableException({
        error: 'Service Unavailable',
        message: `Não consegui preencher: ${describe(error)}`,
      });
    } finally {
      await removeGuard();
    }
  }

  /** A janela, abrindo uma se ainda não houver ou se você fechou a anterior. */
  private async window(): Promise<BrowserContext> {
    if (this.context) {
      try {
        // Uma chamada barata que falha se a janela foi fechada na mão.
        this.context.pages();

        return this.context;
      } catch {
        this.context = null;
      }
    }

    try {
      const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        // Chrome do sistema, não o Chromium do Playwright: evita 300 MB de
        // download numa máquina que já tem navegador.
        channel: 'chrome',
        headless: false,
        viewport: null,
        // Sem isto o Chrome pode abrir diálogo de primeira execução ou de
        // restauração de sessão, e a navegação aborta com `frame was detached`.
        args: ['--no-first-run', '--no-default-browser-check'],
      });

      context.on('close', () => {
        this.context = null;
      });

      this.context = context;

      return context;
    } catch (error) {
      throw new ServiceUnavailableException({
        error: 'Service Unavailable',
        message: `Não consegui abrir o navegador: ${describe(error)}`,
      });
    }
  }

  private async apply(
    page: Page,
    plan: PlannedField[],
    url: string,
  ): Promise<FillReport> {
    const filled: { what: string; value: string }[] = [];
    const skipped: string[] = [];

    for (const item of plan) {
      // Demographic choices require the extension's question-scoped controls;
      // the legacy text-only locator must not guess or expose these as text.
      if (item.sensitive) {
        skipped.push(item.what);
        continue;
      }
      const target = await locateField(page, item);

      if (!target) {
        // Campo não reconhecido fica VAZIO e é reportado. Chutar aqui é pior
        // que não preencher: você pode enviar sem notar o valor errado.
        skipped.push(item.what);
        continue;
      }

      try {
        await target.fill(item.value, { timeout: FIELD_TIMEOUT_MS });
        filled.push({ what: item.what, value: item.value });
      } catch {
        skipped.push(item.what);
      }
    }

    return { url, filled, skipped, submitted: false };
  }
}

function describe(error: unknown): string {
  return error instanceof Error
    ? error.message.split('\n')[0]
    : 'erro desconhecido';
}

/**
 * A URL para NAVEGAR — que não é a URL canônica.
 *
 * Aqui eu usei `canonicalJobUrl` primeiro, e estava errado: ele remove os
 * sufixos `/apply` e `/application` de propósito, porque para efeito de
 * IDENTIDADE o formulário e a página da vaga são a mesma vaga. Só que é
 * exatamente esse sufixo que leva ao formulário — canonizar aqui apagava o
 * destino e a rodada não achava campo nenhum.
 *
 * Identidade e navegação são perguntas diferentes. Esta função só confere se
 * dá para navegar, e devolve o endereço como veio.
 */
function navigableUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());

    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
