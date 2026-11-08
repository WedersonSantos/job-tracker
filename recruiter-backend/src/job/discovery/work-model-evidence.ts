import type { JobSearchResult, WorkModel } from '@recruit/shared';
import { fold, workModelFromText } from './normalize';

// Only statements about this position count; perks and company culture may
// mention several modalities without declaring the modality of this job.
const DECLARED =
  /\b(?:trabalho|modelo(?: de (?:trabalho|atuacao))?|modalidade|atuacao|vaga|posicao|regime|formato)\s*(?:(?:e|sera|is|:|-)\s*)*(?:100\s*%\s*)?(presencial(?:mente)?|hibrid[oa]|remot[oa]|home[ -]?office|on-?site|hybrid|remote)\b/;
const STANDALONE =
  /^(?:[-•▪]\s*)?(?:100\s*%\s*)?(presencial(?:mente)?|hibrid[oa]|remot[oa]|home[ -]?office|on-?site|hybrid|remote)\b/;
function modelFromLabel(value: string): WorkModel | null {
  if (/home[ -]?office|remot[oa]|remote/.test(value)) return 'remoto';
  if (/hibrid[oa]|hybrid/.test(value)) return 'hibrido';
  if (/presencial|on-?site/.test(value)) return 'presencial';
  return null;
}
export function workModelEvidence(job: JobSearchResult) {
  const clauses = [job.title, job.description, ...job.requirements]
    .filter(Boolean)
    .join('\n')
    .replace(/<[^>]*>/g, ' ')
    .split(/[.!?;\n]+/)
    .map(fold)
    .filter(Boolean);
  const statements = clauses.flatMap((clause) => {
    if (
      /\b(?:nao|not required|no need|do not|don't|desejavel|preferencialmente|optional|preferred|ideally|nice to have)\b/.test(
        clause,
      )
    )
      return [];
    // Conditional local arrangements do not override an explicit remote role.
    if (
      /\b(?:se (?:voce|residir|morar)|caso (?:resida|more)|profissionais residentes|para (?:quem|residentes)|if you live)\b/.test(
        clause,
      )
    )
      return [];
    const match =
      DECLARED.exec(clause) ??
      STANDALONE.exec(clause) ??
      /\b(presencial(?:mente)?|on-?site)\s+(?:em|in)\b/.exec(clause) ??
      /\b(presencial(?:mente)?)\s+(?:1|uma|um)\s*(?:x|vez|dia)\b/.exec(clause);
    if (!match) return [];
    let model = modelFromLabel(match[1]);
    if (
      model === 'presencial' &&
      /\b(?:1|uma|um)\s*(?:x|vez|dia)\b.*\b(?:semana|mes)\b|\bdemais\s+(?:dias\s+)?home[ -]?office\b/.test(
        clause,
      )
    )
      model = 'hibrido';
    return [{ model, clause }];
  });
  const title = job.title.replace(
    /\b(?:mobile|aplicativo|aplica[cç][aã]o|cloud|nuvem)\s+h[ií]brid[oa]\b/gi,
    '',
  );
  const labels = [
    job.workModel,
    workModelFromText(title),
    workModelFromText(job.location),
  ];
  const local = statements.find(
    (s) => s.model === 'presencial' || s.model === 'hibrido',
  );
  const model: WorkModel | null =
    labels.find((m) => m === 'presencial' || m === 'hibrido') ??
    local?.model ??
    job.workModel ??
    labels.find(Boolean) ??
    statements.find((s) => s.model === 'remoto')?.model ??
    null;
  return { model, localClause: local?.clause };
}
