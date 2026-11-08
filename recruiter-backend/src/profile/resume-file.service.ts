import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAX_RESUME_PDF_BYTES,
  resumeFileInfoSchema,
  type ResumeFileInfo,
  type UploadResumeFileInput,
  type ResumeImport,
} from '@recruit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { extractResumeText } from './resume-text';
import { parseResumeText } from './resume-import';

export interface ResumeAttachment {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

@Injectable()
export class ResumeFileService {
  private reading = 0;
  constructor(private readonly prisma: PrismaService) {}

  private async directory(id: string) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !(await this.prisma.profile.findUnique({
        where: { id },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Perfil não encontrado.');
    return join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'job-tracker',
      'resumes',
      id,
    );
  }

  async info(id: string): Promise<ResumeFileInfo | null> {
    const dir = await this.directory(id);
    try {
      const data = await readFile(join(dir, 'resume.json'), 'utf8');
      return resumeFileInfoSchema.parse(JSON.parse(data));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(
    id: string,
    input: UploadResumeFileInput,
  ): Promise<ResumeFileInfo> {
    const dir = await this.directory(id);
    const buffer = Buffer.from(input.content, 'base64');
    if (
      buffer.toString('base64') !== input.content ||
      !buffer.length ||
      buffer.length > MAX_RESUME_PDF_BYTES ||
      !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      !buffer.subarray(-2048).includes(Buffer.from('%%EOF'))
    )
      throw new BadRequestException('Selecione um PDF válido de até 5 MB.');
    const info = {
      fileName: input.fileName.replace(/.*[\\/]/, ''),
      size: buffer.length,
      savedAt: new Date().toISOString(),
    };
    await mkdir(dir, { recursive: true });
    // A single atomic record keeps metadata and PDF from different uploads apart.
    const tmp = join(dir, `${randomUUID()}.tmp`);
    try {
      await writeFile(
        tmp,
        JSON.stringify({ ...info, content: input.content }),
        { mode: 0o600 },
      );
      await rename(tmp, join(dir, 'resume.json'));
    } finally {
      await rm(tmp, { force: true });
    }
    return info;
  }

  async attachment(id: string): Promise<ResumeAttachment | null> {
    const dir = await this.directory(id);
    try {
      const raw = JSON.parse(
        await readFile(join(dir, 'resume.json'), 'utf8'),
      ) as ResumeFileInfo & { content: string };
      const info = resumeFileInfoSchema.parse(raw);
      return {
        name: info.fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from(raw.content, 'base64'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const dir = await this.directory(id);
    await rm(join(dir, 'resume.json'), { force: true });
  }

  async import(id: string): Promise<ResumeImport> {
    const attachment = await this.attachment(id);
    if (!attachment)
      throw new BadRequestException(
        'Guarde um currículo em PDF neste perfil primeiro.',
      );
    if (this.reading >= 2)
      throw new BadRequestException(
        'Aguarde a leitura em andamento e tente novamente.',
      );
    this.reading++;
    try {
      const extracted = await extractResumeText(attachment.buffer);
      if (extracted.text.trim().length < 30)
        throw new BadRequestException(
          'O PDF não tem texto legível. Arquivos digitalizados como imagem precisam de OCR. O anexo foi mantido.',
        );
      return parseResumeText(extracted.text, extracted.total);
    } finally {
      this.reading--;
    }
  }
}
