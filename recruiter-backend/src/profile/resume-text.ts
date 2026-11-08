import { BadRequestException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { MAX_RESUME_PDF_BYTES } from '@recruit/shared';

/** Local child process bounds time/memory and isolates native PDF parser failures. */
export async function extractResumeText(
  buffer: Buffer,
): Promise<{ text: string; total: number }> {
  if (
    buffer.length > MAX_RESUME_PDF_BYTES ||
    !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw new BadRequestException('Selecione um PDF válido de até 5 MB.');
  return new Promise((resolve, reject) => {
    const script = `
      (async () => {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: Uint8Array.from(Buffer.concat(chunks)), isEvalSupported: false });
        try {
          const result = await parser.getText({ first: 20 });
          process.stdout.write('JOBTRACKER_PDF_RESULT:' + JSON.stringify({ text: result.pages.map(p => p.text).join('\\n').slice(0, 100000), total: result.total }) + '\\n');
        } finally { await parser.destroy(); }
      })().catch(() => { process.exitCode = 1; });
    `;
    const child = execFile(
      process.execPath,
      ['--max-old-space-size=256', '-e', script],
      {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (!error) {
          try {
            const line = stdout
              .split(/\r?\n/)
              .find((value) => value.startsWith('JOBTRACKER_PDF_RESULT:'));
            const data = JSON.parse(
              line!.slice('JOBTRACKER_PDF_RESULT:'.length),
            ) as { text: string; total: number };
            if (
              typeof data.text === 'string' &&
              typeof data.total === 'number'
            ) {
              resolve(data);
              return;
            }
          } catch {
            /* Report a friendly failure; do not log personal PDF text. */
          }
        }
        reject(
          new BadRequestException(
            'Não consegui ler este PDF. Ele pode estar protegido, danificado ou ser muito complexo. O arquivo continua salvo como anexo.',
          ),
        );
      },
    );
    child.stdin?.on('error', () => {
      /* An early parser failure is handled above. */
    });
    child.stdin?.end(buffer);
  });
}
