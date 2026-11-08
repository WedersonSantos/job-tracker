import { emptyResume, mergeResumeImport } from '@recruit/shared';
import { parseResumeText } from './resume-import';
import { extractResumeText } from './resume-text';
import { ResumeFileService } from './resume-file.service';
import type { PrismaService } from '../prisma/prisma.service';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const sample = `Ana Silva
Analista de Suporte
ana@example.test
(34) 99999-1234
Uberlândia, MG
linkedin.com/in/ana-exemplo
https://github.com/ana-exemplo
https://portfolio.example.test
Resumo profissional
Atendimento técnico e administração de redes.
Experiência profissional
Empresa Modelo | Analista de Suporte
03/2022 - Atual
Atendimento de chamados e manutenção de computadores.
Formação acadêmica
Instituto Modelo | Tecnologia em Redes
02/2018 - 12/2020
Habilidades
Windows, Linux; Redes
Idiomas
Inglês - Intermediário
Certificações
Redes locais | Instituição Modelo
Projetos
Inventário - https://example.test/inventario`;

/** Synthetic PDF with a real text layer; no personal document is used by tests. */
function pdf(lines: string[]): Buffer {
  const stream = `BT /F1 11 Tf 40 790 Td ${lines.map((line, index) => `${index ? '0 -18 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content, 'latin1'));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(content, 'latin1');
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content, 'latin1');
}

describe('local resume import', () => {
  it('extracts explicit contacts, links and professional sections', () => {
    const value = parseResumeText(sample);
    expect(value.fullName).toBe('Ana Silva');
    expect(value.email).toBe('ana@example.test');
    expect(value.location).toBe('Uberlândia, MG');
    expect(value.links.linkedin).toBe('https://linkedin.com/in/ana-exemplo');
    expect(value.links.github).toBe('https://github.com/ana-exemplo');
    expect(value.resume.experiences[0]).toMatchObject({
      company: 'Empresa Modelo',
      role: 'Analista de Suporte',
      startDate: '2022-03',
      endDate: null,
      current: true,
    });
    expect(value.resume.education[0]).toMatchObject({
      school: 'Instituto Modelo',
      startDate: '2018-02',
      endDate: '2020-12',
    });
    expect(value.resume.skills).toEqual(['Windows', 'Linux', 'Redes']);
    expect(value.resume.languages[0]).toEqual({
      name: 'Inglês',
      level: 'Intermediário',
    });
    expect(value.resume.projects[0].url).toBe(
      'https://example.test/inventario',
    );
  });
  it('leaves unknown month and ambiguous sections blank, with a review warning', () => {
    const value = parseResumeText(
      'Ana Silva\nExperiência profissional\nEmpresa Modelo | Analista de Suporte\n2020 - 2022\nFormação\nCurso sem instituição',
    );
    expect(value.resume.experiences[0].startDate).toBeNull();
    expect(value.resume.education).toEqual([]);
    expect(value.warnings.length).toBeGreaterThan(0);
    expect(value.resume.birthDate).toBeNull();
  });
  it('recognizes accented role names and written Portuguese months', () => {
    const value = parseResumeText(
      'Ana Silva\nTécnica de Redes\nExperiência profissional\nEmpresa Modelo | Técnica de Redes\nmarço de 2022 - dezembro de 2024',
    );
    expect(value.fullName).toBe('Ana Silva');
    expect(value.headline).toBe('Técnica de Redes');
    expect(value.resume.experiences[0]).toMatchObject({
      startDate: '2022-03',
      endDate: '2024-12',
    });
  });
  it('preserves existing edits and fills only empty sections', () => {
    const incoming = parseResumeText(sample).resume;
    const result = mergeResumeImport(
      {
        ...emptyResume,
        summary: 'Texto revisado',
        skills: ['Docker'],
        birthDate: '1990-01-02',
      },
      incoming,
    );
    expect(result.summary).toBe('Texto revisado');
    expect(result.skills).toEqual(['Docker']);
    expect(result.birthDate).toBe('1990-01-02');
    expect(result.experiences).toEqual(incoming.experiences);
  });
  it('reads a real PDF locally in the bounded process', async () => {
    const result = await extractResumeText(pdf(sample.split('\n')));
    expect(result.total).toBe(1);
    expect(parseResumeText(result.text).email).toBe('ana@example.test');
    expect(parseResumeText(result.text).location).toBe('Uberlândia, MG');
  }, 20000);
  it('rejects a damaged PDF without crashing the API', async () => {
    await expect(
      extractResumeText(Buffer.from('%PDF-1.4\ninvalid\n%%EOF')),
    ).rejects.toThrow('Não consegui ler');
  }, 20000);
  it('keeps the saved attachment when text is unavailable and rejects unknown profiles', async () => {
    const base = await mkdtemp(join(tmpdir(), 'jobtracker-resume-test-'));
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = base;
    try {
      const prisma = {
        profile: {
          findUnique: jest.fn().mockResolvedValue({ id: 'test-profile' }),
        },
      };
      const service = new ResumeFileService(prisma as unknown as PrismaService);
      const buffer = pdf(['']);
      await service.save('test-profile', {
        fileName: 'curriculo.pdf',
        content: buffer.toString('base64'),
      });
      await expect(service.import('test-profile')).rejects.toThrow(
        'não tem texto legível',
      );
      expect((await service.attachment('test-profile'))?.buffer).toEqual(
        buffer,
      );
      prisma.profile.findUnique.mockResolvedValue(null as never);
      await expect(service.import('another-profile')).rejects.toThrow(
        'Perfil não encontrado',
      );
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
      if (
        !resolve(base).startsWith(resolve(tmpdir()) + '\\') &&
        !resolve(base).startsWith(resolve(tmpdir()) + '/')
      )
        throw new Error('Invalid test folder');
      await rm(base, { recursive: true, force: true });
    }
  }, 20000);
});
