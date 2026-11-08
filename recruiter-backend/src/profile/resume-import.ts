import {
  emptyLinks,
  emptyResume,
  resumeImportSchema,
  type ResumeImport,
  type Experience,
  type Education,
} from '@recruit/shared';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const role =
  /analist|suporte|desenvolv|engenheir|t[eé]cnic|especialist|consultor|assistente|gerente|coordenad|developer|engineer|support|manager|designer|administrador|programador/i;
const school =
  /universidade|faculdade|instituto|escola|university|college|school/i;
const datePattern =
  /\b(?:\d{4}[-/]\d{2}|\d{1,2}\/\d{4}|(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[\p{L}]*\.?\s*(?:de\s*)?\d{4}|(?:19|20)\d{2})\b/giu;
const months = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
function month(value: string | undefined): string | null {
  if (!value) return null;
  const text = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let match = /^(\d{4})[-/](\d{2})$/.exec(text);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12)
    return `${match[1]}-${match[2]}`;
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12)
    return `${match[2]}-${match[1].padStart(2, '0')}`;
  match = /^([a-z]+)\.?\s*(?:de\s*)?(\d{4})$/.exec(text);
  if (!match) return null;
  const key =
    (
      {
        feb: 'fev',
        apr: 'abr',
        may: 'mai',
        aug: 'ago',
        sep: 'set',
        oct: 'out',
        dec: 'dez',
      } as Record<string, string>
    )[match[1].slice(0, 3)] ?? match[1].slice(0, 3);
  const index = months.indexOf(key);
  return index < 0 ? null : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
}
const clean = (line: string) => line.replace(/^[\s•●▪\-–]+/, '').trim();
const parts = (line: string) =>
  line
    .split(/\s*(?:\||[–—]|\s-\s)\s*/)
    .map(clean)
    .filter(Boolean);
const headings: Record<string, string[]> = {
  summary: [
    'resumo',
    'resumoprofissional',
    'perfilprofissional',
    'sobre',
    'sobremim',
    'objetivo',
    'summary',
    'professionalsummary',
    'profile',
  ],
  experiences: [
    'experiencia',
    'experiencias',
    'experienciaprofissional',
    'experienciasprofissionais',
    'historicoprofissional',
    'experience',
    'workexperience',
    'professionalexperience',
  ],
  education: [
    'formacao',
    'formacaoacademica',
    'educacao',
    'escolaridade',
    'education',
    'academicbackground',
  ],
  skills: [
    'habilidades',
    'competencias',
    'competenciastecnicas',
    'conhecimentos',
    'conhecimentostecnicos',
    'tecnologias',
    'skills',
    'technicalskills',
  ],
  languages: ['idiomas', 'languages'],
  certifications: [
    'certificacoes',
    'cursosecertificacoes',
    'cursos',
    'certificates',
    'certifications',
  ],
  projects: ['projetos', 'projects'],
};

type DatedBlock = {
  first: string;
  second: string;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  description: string | null;
};
function blocks(
  lines: string[],
  kind: 'experiences' | 'education',
): DatedBlock[] {
  const anchors: {
    index: number;
    start: number;
    first: string;
    second: string;
    dates: string[];
    current: boolean;
  }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const dates = lines[i].match(datePattern) ?? [];
    if (
      !dates.length ||
      !/(?:\batual\b|\bpresent\b|\bcurrent\b|\bhoje\b|\d{4}\s*$)/i.test(
        lines[i],
      )
    )
      continue;
    const inline = lines[i]
      .replace(datePattern, '')
      .replace(/\b(atual|present|current|hoje)\b/gi, '')
      .replace(/^[\s|–—\-]+|[\s|–—\-]+$/g, '');
    let candidates = inline ? parts(inline) : parts(lines[i - 1] ?? '');
    let start = inline ? i : i - 1;
    if (candidates.length < 2 && i >= 2) {
      candidates = [clean(lines[i - 2]), clean(lines[i - 1])];
      start = i - 2;
    }
    candidates = candidates.map((value) =>
      value
        .replace(/^(?:empresa|cargo|institui[cç][aã]o|curso)\s*:\s*/i, '')
        .trim(),
    );
    if (
      candidates.length !== 2 ||
      candidates.some(
        (value) => !value || value.length > 160 || /[!?]$/.test(value),
      )
    )
      continue;
    if (kind === 'experiences' && !candidates.some((value) => role.test(value)))
      continue;
    if (kind === 'education' && !candidates.some((value) => school.test(value)))
      continue;
    if (
      (kind === 'experiences' &&
        role.test(candidates[0]) &&
        !role.test(candidates[1])) ||
      (kind === 'education' &&
        school.test(candidates[1]) &&
        !school.test(candidates[0]))
    )
      candidates.reverse();
    anchors.push({
      index: i,
      start,
      first: candidates[0],
      second: candidates[1],
      dates,
      current: /\b(atual|present|current|hoje)\b/i.test(lines[i]),
    });
  }
  return anchors.slice(0, 30).map((item, index) => ({
    first: item.first,
    second: item.second,
    startDate: month(item.dates[0]),
    endDate: item.current ? null : month(item.dates[1]),
    current: item.current,
    description:
      lines
        .slice(item.index + 1, anchors[index + 1]?.start ?? lines.length)
        .join('\n')
        .slice(0, 4000) || null,
  }));
}

/** Conservative local extraction: copy explicit text, never infer missing facts. */
export function parseResumeText(text: string, totalPages = 1): ResumeImport {
  const lines = text
    .slice(0, 100000)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
  const sections: Record<string, string[]> = { header: [] };
  let section = 'header';
  for (const line of lines) {
    const [title, ...rest] = line.split(':');
    const match = Object.entries(headings).find(([, names]) =>
      names.includes(normalize(title)),
    );
    if (match) {
      section = match[0];
      sections[section] ??= [];
      if (rest.join(':').trim()) sections[section].push(rest.join(':').trim());
    } else (sections[section] ??= []).push(line);
  }
  const header = sections.header;
  const joined = lines.join('\n');
  const explicitName = lines
    .find((line) => /^nome(?: completo)?\s*:/i.test(line))
    ?.replace(/^nome(?: completo)?\s*:\s*/i, '');
  const candidate =
    explicitName ??
    header.find(
      (line) =>
        !/curr[ií]culo|resume|curriculum|vitae|@|https?:|\d|[:|]/i.test(line) &&
        !role.test(line) &&
        line.split(/\s+/).length >= 2 &&
        line.split(/\s+/).length <= 8,
    );
  const fullName =
    candidate && /^[\p{L} .'-]+$/u.test(candidate)
      ? candidate.slice(0, 160)
      : null;
  const candidateEmail =
    joined.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? null;
  const email = resumeImportSchema.shape.email.safeParse(candidateEmail).success
    ? candidateEmail
    : null;
  const phone =
    joined
      .match(
        /(?:\+55[\s-]*)?(?:\(\d{2}\)|\d{2}[\s-])[\s-]*9?\d{4}[\s-]\d{4}/,
      )?.[0]
      ?.slice(0, 40) ?? null;
  const locationLine = header.find((line) =>
    /^(?:localiza[cç][aã]o|cidade|local|location)\s*:/i.test(line),
  );
  const city = header.find((line) =>
    /^[\p{L} .'-]+\s*[,/–-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/u.test(
      line,
    ),
  );
  const links = { ...emptyLinks };
  for (const raw of joined.match(
    /(?:https?:\/\/|www\.)(?:[^\s<>]+)|(?:linkedin\.com\/in\/|github\.com\/)[^\s<>]+/gi,
  ) ?? []) {
    try {
      const url = new URL(
        (/^https?:/i.test(raw) ? '' : 'https://') + raw.replace(/[),.;]+$/, ''),
      );
      if (
        url.username ||
        url.password ||
        !['http:', 'https:'].includes(url.protocol)
      )
        continue;
      if (
        /(^|\.)linkedin\.com$/i.test(url.hostname) &&
        url.pathname.startsWith('/in/')
      )
        links.linkedin ??= url.href;
      else if (/(^|\.)github\.com$/i.test(url.hostname))
        links.github ??= url.href;
      else if (header.some((line) => line.includes(raw)))
        links.website ??= url.href;
    } catch {
      /* Ignore malformed links. */
    }
  }
  const experiences: Experience[] = blocks(
    sections.experiences ?? [],
    'experiences',
  ).map((item) => ({
    company: item.first,
    role: item.second,
    location: null,
    startDate: item.startDate,
    endDate: item.endDate,
    current: item.current,
    description: item.description,
  }));
  const education: Education[] = blocks(
    sections.education ?? [],
    'education',
  ).map((item) => ({
    school: item.first,
    degree: item.second,
    field: null,
    startDate: item.startDate,
    endDate: item.endDate,
  }));
  // Education without dates can still be an explicit institution/course pair.
  if (!education.length)
    for (const line of sections.education ?? []) {
      const pair = parts(line);
      if (
        pair.length === 2 &&
        school.test(pair[0]) &&
        pair.every((value) => value.length <= 160)
      )
        education.push({
          school: pair[0],
          degree: pair[1],
          field: null,
          startDate: null,
          endDate: null,
        });
    }
  const skills = [
    ...new Set(
      (sections.skills ?? [])
        .flatMap((line) => line.split(/[,;•|·]/))
        .map(clean)
        .filter((value) => value.length > 0 && value.length <= 80),
    ),
  ].slice(0, 100);
  const languages = (sections.languages ?? [])
    .flatMap((line) => {
      const match =
        /^(portugu[eê]s|ingl[eê]s|espanhol|franc[eê]s|alem[aã]o|italiano|japon[eê]s|mandarim|english|spanish|french|german)\b\s*[:|–—-]?\s*(.*)$/i.exec(
          clean(line),
        );
      return match
        ? [
            {
              name: match[1],
              level:
                match[2].replace(/^[ (]+|[ )]+$/g, '').slice(0, 160) || null,
            },
          ]
        : [];
    })
    .slice(0, 30);
  const certifications = (sections.certifications ?? [])
    .map(clean)
    .filter((value) => value && value.length <= 200)
    .slice(0, 40)
    .map((line) => {
      const pair = parts(line);
      return {
        name: pair[0].slice(0, 200),
        issuer: pair[1]?.slice(0, 160) ?? null,
        date: null,
      };
    });
  const projects = (sections.projects ?? [])
    .filter((line) => /https?:\/\//i.test(line))
    .slice(0, 20)
    .flatMap((line) => {
      const raw = line.match(/https?:\/\/[^\s)]+/i)?.[0];
      const name = line
        .replace(raw ?? '', '')
        .replace(/[|–—: -]+$/, '')
        .trim();
      try {
        const url = new URL(raw!);
        return name &&
          name.length <= 160 &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password
          ? [{ name, url: url.href, description: null }]
          : [];
      } catch {
        return [];
      }
    });
  const warnings: string[] = [];
  if (
    !fullName &&
    !email &&
    !phone &&
    !experiences.length &&
    !education.length &&
    !skills.length &&
    !sections.summary?.length
  )
    warnings.push(
      'O texto foi lido, mas não consegui identificar os campos com segurança. Preencha os dados manualmente.',
    );
  if (totalPages > 20)
    warnings.push('Foram lidas somente as primeiras 20 páginas do PDF.');
  if (sections.experiences?.length && !experiences.length)
    warnings.push(
      'Não consegui separar as experiências com segurança. Preencha essa seção manualmente.',
    );
  if (sections.education?.length && !education.length)
    warnings.push(
      'Não consegui separar a formação com segurança. Preencha essa seção manualmente.',
    );
  if (
    /\b(?:19|20)\d{2}\b/.test(joined) &&
    [...experiences, ...education].some((item) => !item.startDate)
  )
    warnings.push(
      'Datas sem mês identificado foram deixadas em branco. Confira os períodos.',
    );
  return resumeImportSchema.parse({
    fullName,
    headline:
      header.find(
        (line) =>
          line !== candidate &&
          role.test(line) &&
          line.length <= 120 &&
          !/@|https?:/.test(line),
      ) ?? null,
    email,
    phone,
    location:
      (locationLine?.replace(/^[^:]+:\s*/, '') ?? city)?.slice(0, 160) ?? null,
    links,
    resume: {
      ...emptyResume,
      summary: sections.summary?.join('\n').slice(0, 4000) || null,
      experiences,
      education,
      skills,
      languages,
      certifications,
      projects,
    },
    warnings,
  });
}
