import type {
  JobPreferences,
  JobSearchResult,
  Seniority,
} from '@recruit/shared';
import { countryFromText, fold } from './normalize';
import { matchesProfileLocation } from './location-eligibility';
import { workModelEvidence } from './work-model-evidence';

/**
 * Os cortes que decidem se uma vaga existe para você.
 *
 * Em arquivo próprio, e não dentro do serviço, por dois motivos: são funções
 * puras e é onde os defeitos silenciosos moram — o escopo já descartou quatro
 * de cada cinco vagas brasileiras sem dizer nada. Separado, dá para exercitar
 * sem subir o Nest, que arrasta `@nestjs/config` e quebra o Jest.
 */

/**
 * O texto digitado também FILTRA, e não só orienta as fontes.
 *
 * Gupy e os portais aceitam termo de busca; Greenhouse, Ashby e Lever devolvem
 * o board inteiro e ignoram. Sem este corte, digitar "clojure" trazia 518
 * vagas — a caixa dizia "filtrar" e não filtrava.
 */
export function matchesTerm(job: JobSearchResult, term?: string): boolean {
  const wanted = fold(term ?? '');

  if (wanted === '') {
    return true;
  }

  const haystack = fold(
    [job.title, job.company, job.stack.join(' '), job.location].join(' '),
  );

  // Todas as palavras precisam aparecer: "backend go" não pode trazer toda
  // vaga que tenha "backend" OU "go".
  return wanted.split(' ').every((word) => haystack.includes(word));
}

/**
 * Corte pelas preferências.
 *
 * Preferência ELIMINA, currículo ORDENA — são coisas diferentes de propósito.
 * Campos ausentes normalmente passam. A modalidade é exceção quando há uma
 * seleção restrita: desconhecido não comprova remoto nem presencial local.
 */
export function matches(
  job: JobSearchResult,
  preferences: JobPreferences,
  now: Date = new Date(),
  profileLocation?: string | null,
): boolean {
  if (tooOldLinkedIn(job, preferences, now)) {
    return false;
  }

  const title = fold(job.title);

  if (preferences.titleExcludes.some((term) => title.includes(fold(term)))) {
    return false;
  }

  if (
    preferences.titleIncludes.length > 0 &&
    !preferences.titleIncludes.some((term) => title.includes(fold(term)))
  ) {
    return false;
  }

  const model = workModelEvidence(job).model;
  if (preferences.workModels.length > 0) {
    if (model && !preferences.workModels.includes(model)) return false;
    // A restricted selection needs evidence: unknown does not mean remote
    // (nor does it prove an onsite job is in the candidate's city).
    if (!model && preferences.workModels.length < 3) return false;
  }

  if (
    job.contractType !== null &&
    preferences.contractTypes.length > 0 &&
    !preferences.contractTypes.includes(job.contractType)
  ) {
    return false;
  }

  if (
    job.seniority !== null &&
    preferences.seniorities.length > 0 &&
    !preferences.seniorities.includes(job.seniority as Seniority)
  ) {
    return false;
  }

  return (
    withinScope(job, preferences) &&
    matchesProfileLocation(job, profileLocation)
  );
}

/**
 * Vaga de alerta do LinkedIn mais velha que o limite que você escolheu.
 *
 * `postedAt` dessa fonte é o dia em que a vaga apareceu pela PRIMEIRA vez num
 * alerta: republicada em alertas seguintes, ela não rejuvenesce. É o mais
 * perto da data de publicação que dá para saber sem abrir o LinkedIn.
 *
 * Sem data, passa — mesma regra dos outros campos: cortar por falta de dado
 * esconde vaga boa sem você saber.
 */
function tooOldLinkedIn(
  job: JobSearchResult,
  preferences: JobPreferences,
  now: Date,
): boolean {
  if (job.source !== 'linkedin-alerts' || !job.postedAt) {
    return false;
  }

  const age = now.getTime() - new Date(job.postedAt).getTime();

  return age > preferences.linkedinMaxAgeDays * 24 * 60 * 60 * 1000;
}

function withinScope(
  job: JobSearchResult,
  preferences: JobPreferences,
): boolean {
  // Nenhum lado escolhido é tanto faz: o estado neutro é a ausência de opção,
  // não um terceiro valor.
  if (preferences.scope === null) {
    return true;
  }

  // `countryFromText` e não um teste por "brasil" no texto: o teste literal
  // tratava QUALQUER localização não nula sem a palavra "brasil" como
  // definitivamente estrangeira. Das formas que o LinkedIn usa — "Salvador,
  // BA", "São Paulo, SP", "Porto Alegre, RS", "São Paulo e Região" — quatro em
  // cinco eram descartadas, sem log e sem entrar em `failedSources`.
  const country = countryFromText(job.location);

  // Localização não reconhecida passa, pela mesma regra acima — agora de
  // verdade, porque `countryFromText` devolve `null` quando não sabe em vez de
  // afirmar "não é Brasil".
  if (country === null) {
    return true;
  }

  return preferences.scope === 'brasil'
    ? country === 'Brasil'
    : country !== 'Brasil';
}
