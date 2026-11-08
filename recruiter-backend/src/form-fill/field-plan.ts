import type { FormFillDefaults, ProfileLinks, Resume } from '@recruit/shared';

const REQUIRED_SUFFIX = String.raw`\s*[:*?]*\s*(?:\((?:obrigat[oó]rio|required)\))?\s*[:*?]*$`;
export const FULL_NAME_LABEL = new RegExp(
  String.raw`^(?:nome completo|nome e sobrenome|full name|your full name|name(?: \(first and last\))?)${REQUIRED_SUFFIX}`,
  'i',
);
export const FIRST_NAME_LABEL = new RegExp(
  String.raw`^(?:nome|first name|given name|primeiro nome)${REQUIRED_SUFFIX}`,
  'i',
);

/**
 * O que preencher, e por quais rótulos reconhecer cada campo.
 *
 * Puro e sem navegador: é a parte que decide, e decidir se testa sem abrir
 * Chrome. O módulo do navegador só executa este plano.
 *
 * **Reconhecimento por RÓTULO, e isso não é preferência — foi medido.**
 * Inspecionei um formulário real da Ashby: os campos do sistema têm nome
 * estável (`_systemfield_name`, `_systemfield_email`), mas toda pergunta
 * personalizada tem nome UUID (`a284132b-d133-...`), diferente a cada vaga.
 * E NENHUM campo declara `autocomplete` — o atributo que eu esperava usar como
 * segunda camada simplesmente não existe nesses formulários.
 *
 * O que sobra estável é o texto que a PESSOA lê. Um ATS troca o id de um campo
 * numa release qualquer; ele não para de escrever "E-mail" ao lado da caixa.
 */

export interface PlannedField {
  /** Só para log e para a tela dizer o que foi preenchido. */
  readonly what: string;
  /** Rótulos aceitáveis, em português e inglês. */
  readonly labels: RegExp;
  /** Nomes de campo conhecidos, como reforço — nunca como sinal principal. */
  readonly names?: RegExp;
  readonly value: string;
  readonly autocomplete?: string;
  readonly sensitive?: boolean;
}

export interface FillSource {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: ProfileLinks | null;
  resume: Resume | null;
  defaults?: FormFillDefaults | null;
}

/**
 * Monta o plano a partir do perfil.
 *
 * Campo sem valor NÃO entra no plano. Preencher com string vazia apagaria algo
 * que o ATS já tivesse preenchido a partir da sua conta — e um campo em branco
 * que você não notou é pior que um campo que você viu vazio e preencheu.
 */
export function buildFieldPlan(source: FillSource): PlannedField[] {
  const fullName = source.defaults?.fullName?.trim() || source.name;
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.join(' ');

  const candidates: (PlannedField | null)[] = [
    ...[
      [
        'PCD',
        /^(?:(?:voc[eê] (?:[ée]|se considera)|[ée]) (?:uma )?(?:pessoa com defici[eê]ncia(?: \(PCD\))?|PCD)|pessoa com defici[eê]ncia(?: \(PCD\))?|PCD|(?:do you have a |person with a )disability|disability status)\s*[:*?]*$/i,
        source.defaults?.disabilityStatus,
      ],
      [
        'CID',
        /^(?:CID(?:[- ]?(?:10|11))?(?: da defici[eê]ncia)?|c[oó]digo (?:do )?CID(?:[- ]?(?:10|11))?)\s*[:*?]*$/i,
        source.defaults?.disabilityStatus === 'Sim'
          ? source.defaults.disabilityCid
          : null,
      ],
      [
        'cor ou raça',
        /^(?:(?:qual (?:[ée] )?(?:a )?sua )?(?:cor(?: (?:ou|\/) ra[çc]a)?|ra[çc]a(?: (?:ou|\/) cor)?|ra[çc]a\s*\/\s*etnia|etnia)|race(?:\s*\/\s*ethnicity)?|ethnicity)\s*[:*?]*$/i,
        source.defaults?.race,
      ],
      [
        'sexo',
        /^(?:(?:qual (?:[ée] )?(?:o )?seu )?sexo(?: (?:biol[oó]gico|atribu[ií]do ao nascer))?|sex(?: assigned at birth)?)\s*[:*?]*$/i,
        source.defaults?.sex,
      ],
      [
        'identidade de gênero',
        /^(?:(?:qual (?:[ée] )?(?:a )?sua )?identidade de g[eê]nero|g[eê]nero|com qual g[eê]nero voc[eê] se identifica|gender(?: identity)?)\s*[:*?]*$/i,
        source.defaults?.genderIdentity,
      ],
      [
        'orientação sexual',
        /^(?:(?:qual (?:[ée] )?(?:a )?sua )?orienta[çc][aã]o sexual|sexual orientation)\s*[:*?]*$/i,
        source.defaults?.sexualOrientation,
      ],
    ].map(([what, labels, value]) => {
      const planned = field(
        what as string,
        labels as RegExp,
        (value as string | null | undefined) ?? null,
      );
      return planned ? { ...planned, sensitive: true } : null;
    }),
    field(
      'país de origem',
      /^(?:pa[ií]s de origem|country of origin|birth country)\s*[:*?]*$/i,
      source.defaults?.countryOfOrigin ?? null,
      /^(?:countryOfOrigin|country_of_origin|pais_origem|birthCountry)$/i,
    ),
    field(
      'CPF',
      /^cpf(?:\s*\([^)]*\))?\s*[:*?]*$/i,
      source.defaults?.cpf ?? null,
      /^(?:cpf|cpfNumber|cpf_number|document_cpf)$/i,
    ),
    field(
      'nível de inglês',
      new RegExp(
        String.raw`^(?:(?:qual (?:[ée] )?(?:o )?(?:seu )?)?n[ií]vel (?:de |do )?ingl[eê]s|(?:what is )?(?:your )?english (?:level|proficiency))${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.resume?.languages.find((language) =>
        /^(?:ingl[eê]s|english)$/i.test(language.name.trim()),
      )?.level ?? null,
      /^(?:english[_-]?(?:level|proficiency)|nivel[_-]?ingles)$/i,
    ),
    field(
      'nome completo',
      FULL_NAME_LABEL,
      fullName,
      /^(?:_systemfield_name|full[_-]?name|fullname|name|nome_completo)$/i,
      'name',
    ),
    field(
      'primeiro nome',
      FIRST_NAME_LABEL,
      first,
      /first.?name/i,
      'given-name',
    ),
    field(
      'sobrenome',
      new RegExp(
        String.raw`^(?:sobrenome|last name|family name|surname)${REQUIRED_SUFFIX}`,
        'i',
      ),
      last || null,
      /last.?name/i,
      'family-name',
    ),
    field('email', /e-?mail/i, source.email, /_systemfield_email|email/i),
    field(
      'telefone',
      /(telefone|celular|phone|mobile)/i,
      source.phone,
      /phone|tel/i,
    ),
    // NÃO casa pergunta de país: `Profile.location` é cidade e estado
    // ("São Paulo, SP"), e num formulário real isso foi parar em "What country
    // are you based in?". Campo vazio é melhor que resposta no nível errado.
    field(
      'localização',
      /(cidade|localiza(ção|cao)|location|city|where are you based)/i,
      source.location,
      /location|city/i,
    ),
    field(
      'LinkedIn',
      /linked-?in/i,
      source.links?.linkedin ?? null,
      /linkedin/i,
    ),
    field('GitHub', /git-?hub/i, source.links?.github ?? null, /github/i),
    field(
      'portfólio / site',
      new RegExp(
        String.raw`^(?:(?:link|url)(?: do| de| para o| to| for)? )?(?:(?:seu|your) )?(?:site(?: pessoal)?|website|personal (?:website|page)|portf[oó]lio|portfolio)(?: (?:link|url))?${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.links?.website ?? null,
      /^(?:website|portfolio|site|personal[_-]?(?:website|site)|(?:website|portfolio)[_-]?(?:url|link))$/i,
    ),
    field(
      'vídeo de apresentação',
      new RegExp(
        String.raw`^(?:(?:link|url)(?: do| de| para o| to| for| of)? )?(?:(?:seu|your) )?(?:v[ií]deo(?: de apresenta[çc][aã]o)?|apresenta[çc][aã]o em v[ií]deo|(?:self[- ]|personal )?(?:introduction|intro|presentation) video|video (?:introduction|presentation)|video|loom)(?: (?:link|url))?${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.links?.presentationVideo ?? null,
      /^(?:(?:presentation|introduction|intro)[_-]?video(?:[_-]?(?:url|link))?|video[_-]?(?:url|link)|loom(?:[_-]?(?:url|link))?|video[_-]?apresentacao)$/i,
    ),
    field(
      'último salário',
      new RegExp(
        String.raw`^(?:\d+[.)-]\s*)?(?:(?:qual (?:(?:foi|era) )?(?:a sua |o seu |sua |seu ))?(?:[uú]ltimo(?:\s*(?:/|ou)\s*atual)? sal[aá]rio|sal[aá]rio anterior|[uú]ltima(?:\s*(?:/|ou)\s*atual)? remunera[çc][aã]o|remunera[çc][aã]o anterior)|(?:your )?(?:last salary|previous salary|most recent salary|last compensation|previous compensation))${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.defaults?.lastSalary ?? null,
      /^(?:last[_-]?salary|previous[_-]?salary|ultimo[_-]?salario|salario[_-]?anterior|ultima[_-]?remuneracao|last[_-]?remuneration|previous[_-]?compensation|last[_-]?compensation)$/i,
    ),
    field(
      'pretensão salarial',
      new RegExp(
        String.raw`^(?:\d+[.)-]\s*)?(?:(?:qual (?:[ée] )?(?:a )?sua )?(?:pretens[aã]o salarial|expectativa salarial)|(?:what (?:is|are) your )?(?:salary expectations?|expected salary|desired salary)|(?:your )?compensation expectations?)${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.defaults?.salaryExpectation ?? null,
      /^(?:salary|salary[_-]?(?:expectation|expectations|expected)|expected[_-]?salary|pretensao[_-]?salarial)$/i,
    ),
    field(
      'resumo de experiência',
      new RegExp(
        String.raw`^(?:resumo(?: (?:de experi[eê]ncia|profissional|das? (?:suas? )?experi[eê]ncias?))?|experience summary|professional summary|summary)${REQUIRED_SUFFIX}`,
        'i',
      ),
      source.defaults?.experienceSummary ?? null,
      /^(?:summary|experience[_-]?summary|professional[_-]?summary|resumo[_-]?(?:experiencia|profissional))$/i,
    ),
  ];

  return candidates.filter((item): item is PlannedField => item !== null);
}

function field(
  what: string,
  labels: RegExp,
  value: string | null,
  names?: RegExp,
  autocomplete?: string,
): PlannedField | null {
  const trimmed = value?.trim();

  return trimmed ? { what, labels, value: trimmed, names, autocomplete } : null;
}

/**
 * Rótulos que NUNCA devem ser preenchidos automaticamente.
 *
 * Carta de apresentação e pergunta aberta são específicas da vaga — resposta
 * genérica ali é pior que campo vazio. Salário só é liberado pelo localizador
 * para a resposta de pretensão explicitamente configurada pelo usuário.
 */
export const NEVER_FILL =
  /(carta|cover letter|por que|why do you|pretens|salary|expectativ|disponibilidade|availability|quando pode|notice period)/i;
