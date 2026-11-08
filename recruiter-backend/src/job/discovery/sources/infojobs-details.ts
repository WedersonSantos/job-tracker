import { parseDocument, DomUtils } from 'htmlparser2';
import type { WorkModel } from '@recruit/shared';
import { fold, workModelFromText } from '../normalize';

/** InfoJobs does not always include its visible work model in JobPosting JSON-LD. */
export function infoJobsWorkModel(html: string): WorkModel | null {
  const doc = parseDocument(html);
  const header = DomUtils.findOne(
    (node) => node.attribs.id === 'VacancyHeader',
    doc.children,
  );
  if (!header) return null;
  const labels = DomUtils.findAll(
    (node) => ['div', 'span'].includes(node.name),
    header.children,
  )
    .map((node) => fold(DomUtils.textContent(node)))
    .filter((text) =>
      /^(?:presencial|hibrid[oa]|remot[oa]|home[ -]?office)$/.test(text),
    );
  const models = new Set(
    labels
      .map((text) =>
        /home[ -]?office/.test(text)
          ? ('remoto' as const)
          : workModelFromText(text),
      )
      .filter((model): model is WorkModel => model !== null),
  );
  return models.size === 1 ? [...models][0] : null;
}
