import type { Locator, Page } from 'playwright-core';
import type { ResumeAttachment } from '../profile/resume-file.service';

const RESUME = /curr[ií]culo|r[eé]sum[eé]|\bcv\b/i;
const OTHER_DOCUMENT =
  /cover.?letter|carta|photo|foto|passport|passaporte|certificad/i;
const UPLOAD =
  /^(?:(?:carregar|anexar|selecionar|adicionar)(?: (?:o|um|seu))? curr[ií]culo|(?:upload|attach|choose|add)(?: (?:your|a))? (?:resume|résumé|cv))\s*\*?$/i;

export interface AttachmentReport {
  status: 'attached' | 'skipped';
  fileName: string;
  message: string;
}

export async function resumeInputs(page: Page): Promise<Locator[]> {
  const found: Locator[] = [];
  for (const frame of page.frames()) {
    for (const input of await frame.locator('input[type="file"]').all()) {
      const description = await input.evaluate((element) =>
        [
          element.getAttribute('name'),
          element.id,
          element.getAttribute('aria-label'),
          ...Array.from((element as HTMLInputElement).labels ?? []).map(
            (l) => l.textContent,
          ),
        ].join(' '),
      );
      if (RESUME.test(description) && !OTHER_DOCUMENT.test(description))
        found.push(input);
    }
  }
  return found;
}

export async function resumeButtons(page: Page): Promise<Locator[]> {
  const found: Locator[] = [];
  for (const frame of page.frames()) {
    for (const button of await frame
      .getByRole('button', { name: UPLOAD })
      .or(frame.getByRole('link', { name: UPLOAD }))
      .all()) {
      const submits = await button.evaluate(
        (e) =>
          (e instanceof HTMLButtonElement && e.type === 'submit') ||
          e.getAttribute('type') === 'submit',
      );
      if ((await button.isVisible()) && (await button.isEnabled()) && !submits)
        found.push(button);
    }
  }
  return found;
}

export async function attachResume(
  page: Page,
  file: ResumeAttachment,
): Promise<AttachmentReport> {
  const result = (
    status: AttachmentReport['status'],
    message: string,
  ): AttachmentReport => ({ status, fileName: file.name, message });
  const inputs = await resumeInputs(page);
  if (inputs.length === 1) {
    const input = inputs[0];
    if (
      await input.evaluate((e) =>
        Boolean((e as HTMLInputElement).files?.length),
      )
    )
      return result(
        'skipped',
        'Já existe um arquivo selecionado; confira o currículo no portal.',
      );
    try {
      await input.setInputFiles(file, { timeout: 5_000 });
      return result(
        'attached',
        'PDF selecionado no formulário; confira o anexo no portal antes de enviar.',
      );
    } catch {
      return result(
        'skipped',
        'Não consegui selecionar o PDF neste campo. Anexe manualmente no portal.',
      );
    }
  }
  if (inputs.length > 1)
    return result(
      'skipped',
      'Há mais de um campo de currículo. Escolha o anexo manualmente no portal.',
    );

  const buttons = await resumeButtons(page);
  if (buttons.length) {
    const chooser = page
      .waitForEvent('filechooser', { timeout: 3_000 })
      .catch(() => null);
    try {
      await buttons[0].click({ timeout: 3_000 });
      const opened = await chooser;
      if (opened) {
        await opened.setFiles(file, { timeout: 5_000 });
        return result(
          'attached',
          'PDF selecionado no formulário; confira o anexo no portal antes de enviar.',
        );
      }
    } catch {
      await chooser;
    }
  }
  return result(
    'skipped',
    'Não encontrei um campo de currículo reconhecido. Anexe o PDF manualmente no portal.',
  );
}
