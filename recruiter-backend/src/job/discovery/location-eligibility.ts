import type { JobSearchResult } from '@recruit/shared';
import { countryFromText, fold } from './normalize';
import { workModelEvidence } from './work-model-evidence';

const STATES: Record<string, string> = Object.fromEntries(
  [
    ['AC', 'acre'],
    ['AL', 'alagoas'],
    ['AP', 'amapa'],
    ['AM', 'amazonas'],
    ['BA', 'bahia'],
    ['CE', 'ceara'],
    ['DF', 'distrito federal'],
    ['ES', 'espirito santo'],
    ['GO', 'goias'],
    ['MA', 'maranhao'],
    ['MT', 'mato grosso'],
    ['MS', 'mato grosso do sul'],
    ['MG', 'minas gerais'],
    ['PA', 'para'],
    ['PB', 'paraiba'],
    ['PR', 'parana'],
    ['PE', 'pernambuco'],
    ['PI', 'piaui'],
    ['RJ', 'rio de janeiro'],
    ['RN', 'rio grande do norte'],
    ['RS', 'rio grande do sul'],
    ['RO', 'rondonia'],
    ['RR', 'roraima'],
    ['SC', 'santa catarina'],
    ['SP', 'sao paulo'],
    ['SE', 'sergipe'],
    ['TO', 'tocantins'],
  ].flatMap(([code, name]) => [
    [fold(code), code],
    [name, code],
  ]),
);

interface Place {
  city: string | null;
  state: string | null;
  country: string | null;
}
const BROAD =
  /^(?:brasil|brazil|portugal|united states|usa|canada|worldwide|anywhere|global|latam|latin america|america latina|europe|remote|remoto)$/;

/** No geocoding or distance guesses: missing or ambiguous evidence is preserved. */
function place(raw: string): Place {
  let value = fold(raw)
    .replace(/\([^)]*\)/g, '')
    .replace(
      /^(?:remote|remoto|hybrid|hibrido|presencial|on-site)\s*[-,:/]?\s*/,
      '',
    )
    .trim();
  const stateOnly = /^(?:estado (?:de|do)|state of)\s+/.test(value);
  value = value
    .replace(
      /^(?:estado (?:de|do)|state of|cidade (?:de|do)|city of|regiao (?:de|da)|grande)\s+/,
      '',
    )
    .replace(/\s+(?:e regiao|e proximidades|ou regiao|metropolitan area)$/, '');
  const country = countryFromText(value);
  value = value.replace(/\s+-\s+/g, ',');
  value = value.replace(/\s+([a-z]{2})$/, (all, code: string) =>
    STATES[code] ? `/${code}` : all,
  );
  const parts = value.split(/\s*[,/|]\s*|\s+-\s+/).filter(Boolean);
  const city = parts[0] ?? '';
  const state =
    parts
      .slice(1)
      .map((p) => STATES[p])
      .find(Boolean) ?? null;
  if (
    stateOnly ||
    /^[a-z]{2}$/.test(city) ||
    (parts.length === 1 &&
      STATES[city] &&
      !['sao paulo', 'rio de janeiro'].includes(city))
  )
    return { city: null, state: STATES[city] ?? null, country };
  if (
    BROAD.test(city) ||
    /\d|\b(?:regiao|region|qualquer|todo|toda|fuso|timezone|disponibilidade)\b/.test(
      city,
    ) ||
    !/^[a-z][a-z '\u2019.-]{1,70}$/.test(city)
  )
    return { city: null, state, country };
  return { city, state, country };
}

function compatible(home: Place, target: Place): boolean | null {
  if (home.country && target.country && home.country !== target.country)
    return false;
  if (home.state && target.state && home.state !== target.state) return false;
  if (home.city && target.city) return home.city === target.city;
  if (home.state && target.state) return true;
  if (!target.city && !target.state && home.country && target.country)
    return home.country === target.country;
  return null;
}

/** Preserve spelling for portal searches while resolving full state names. */
export function portalSearchLocation(raw: string | null | undefined) {
  const parsed = place(raw ?? '');
  return {
    city: parsed.city ? raw!.split(/[,/|]|\s+-\s+/)[0].trim() : null,
    state: parsed.state,
  };
}

function compatibleAlternatives(
  home: Place,
  raw: string,
  fallback: string | null,
  requireCity = false,
): boolean {
  let value = fold(raw)
    .split(
      /\s+(?:para|com|porque|where|with|to work)\s+|\s+e\s+(?:ter|possuir|estar|atuar|trabalhar)\b/,
    )[0]
    .trim();
  value = value.replace(/\s+(?:e|ou)\s+(?:regiao|proximidades)$/, '');
  if (
    /^(?:(?:a |na )?regiao|cidade|localidade)(?: da vaga| de trabalho)?$/.test(
      value,
    )
  )
    value = fold(fallback ?? '');
  value = value
    .replace(/,\s*(?:brasil|brazil)\b/g, '')
    .replace(/,\s*([^,/]+)(?=\s*(?:,|$))/g, (match, state: string) =>
      STATES[fold(state)] ? `/${STATES[fold(state)]}` : match,
    );
  const results = value
    .split(/\s+(?:ou|or|e\/ou|and|e)\s+|,\s*/)
    .filter(Boolean)
    .map((p) => {
      const target = place(p);
      if (requireCity && (!home.city || !target.city)) return false;
      return compatible(home, target);
    });
  if (requireCity) return results.some((r) => r === true);
  return results.length === 0 || results.some((r) => r !== false);
}

export function matchesProfileLocation(
  job: JobSearchResult,
  profileLocation?: string | null,
): boolean {
  const home = place(profileLocation ?? '');
  const raw = [job.description, ...job.requirements]
    .filter(Boolean)
    .join('\n')
    .replace(/<[^>]*>/g, ' ');
  const clauses = raw
    .split(/[.!?;\n]+|\b(?:mas|por[eé]m|however|but)\b/i)
    .map(fold)
    .filter(Boolean);
  const { model, localClause } = workModelEvidence(job);
  const requireCity =
    model === 'presencial' ||
    /\b(?:presencial|on-site)\b/.test(localClause ?? '');
  if (requireCity && !home.city) return false;
  if (!home.city && !home.state) return true;
  for (const clause of clauses) {
    // Optional residence and explicitly waived requirements do not exclude a job.
    if (
      /\b(?:nao|sem necessidade|not required|no need|do not|don't|desejavel|preferencialmente|preferencia|preferred|ideally|nice to have)\b/.test(
        clause,
      )
    )
      continue;
    const residence =
      /\b(?:residir|resida|morar|more|residentes?|residencia(?: fixa)?(?: obrigatoria)?)(?:\s+(?:obrigatoriamente|atualmente))?\s+(?:em|na|no)\s+(.+)/.exec(
        clause,
      ) ??
      /\b(?:must (?:currently )?(?:be based|be located|reside|live)|(?:only )?candidates? (?:based|residing|living)|applicants? must (?:reside|live|be based))\s+in\s+(.+)/.exec(
        clause,
      );
    if (residence && !compatibleAlternatives(home, residence[1], job.location))
      return false;
  }

  if (model === 'presencial' || model === 'hibrido' || localClause) {
    const explicit = localClause
      ? /\b(?:presencial(?:mente)?|hibrid[oa]|on-site|hybrid)\s+(?:em|in)\s+(.+)/.exec(
          localClause,
        )?.[1]
      : undefined;
    if (
      !compatibleAlternatives(
        home,
        explicit ?? job.location ?? '',
        null,
        requireCity,
      )
    )
      return false;
  }
  return true;
}
