import type { Frame, Locator, Page } from 'playwright-core';
import { NEVER_FILL, type PlannedField } from './field-plan';

export async function locateField(
  page: Page,
  item: PlannedField,
): Promise<Locator | null> {
  for (const frame of page.frames()) {
    const found = await locateInFrame(frame, item);
    if (found) return found;
  }
  return null;
}

export async function locateInFrame(
  frame: Frame,
  item: PlannedField,
): Promise<Locator | null> {
  const labelled = frame
    .getByLabel(item.labels)
    .or(frame.getByPlaceholder(item.labels));
  for (const candidate of await labelled.all()) {
    if (await usable(candidate, item)) return candidate;
  }
  for (const candidate of await frame.locator('input, textarea').all()) {
    const name = await candidate.getAttribute('name');
    const id = await candidate.getAttribute('id');
    const autocomplete = (await candidate.getAttribute('autocomplete'))
      ?.split(/\s+/)
      .at(-1);
    const matches =
      (name && item.labels.test(name)) ||
      (name && item.names?.test(name)) ||
      (id && item.names?.test(id)) ||
      (item.autocomplete && autocomplete === item.autocomplete);
    if (matches && (await usable(candidate, item))) return candidate;
  }
  return null;
}

async function usable(target: Locator, item: PlannedField): Promise<boolean> {
  if (
    !(await target.isVisible()) ||
    !(await target.isEditable().catch(() => false))
  )
    return false;
  const texts = await target.evaluate((element) => [
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('name'),
    ...Array.from((element as HTMLInputElement).labels ?? []).map(
      (label) => label.textContent,
    ),
  ]);
  // Salary is opt-in and only accepts the answer explicitly stored by the user.
  const blocked =
    item.what === 'pretensão salarial'
      ? /(carta|cover letter|por que|why do you|disponibilidade|availability|quando pode|notice period|sal[aá]rio atual|current salary|previous salary|sal[aá]rio anterior)/i
      : item.what === 'último salário'
        ? /(carta|cover letter|por que|why do you|disponibilidade|availability|quando pode|notice period|pretens|expectativ|expected salary|desired salary|sal[aá]rio atual|current salary)/i
        : NEVER_FILL;
  return !texts.some((text) => text !== null && blocked.test(text));
}
