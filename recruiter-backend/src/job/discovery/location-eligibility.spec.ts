import { defaultJobPreferences, type JobSearchResult } from '@recruit/shared';
import { matches } from './filters';

function job(over: Partial<JobSearchResult> = {}): JobSearchResult {
  return {
    title: 'Desenvolvedor Python',
    company: 'Exemplo',
    url: 'https://example.com/job',
    source: 'gupy',
    stack: ['Python'],
    description: null,
    requirements: [],
    benefits: [],
    seniority: null,
    workModel: 'remoto',
    contractType: null,
    location: 'São Paulo, SP',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    postedAt: null,
    ...over,
  };
}
const now = new Date('2026-10-29T12:00:00Z');
const match = (
  over: Partial<JobSearchResult> = {},
  home: string | null = 'Uberlândia, MG',
) => matches(job(over), defaultJobPreferences, now, home);

describe('location of the candidate', () => {
  it.each([
    'Presencial em São Paulo/SP.',
    'Esta vaga é presencial em São Paulo.',
    'Atuação presencialmente em São Paulo.',
    'Presencial uma vez na semana somente, demais Home Office.',
  ])(
    'recognizes required local work without structured modality: %s',
    (description) => {
      expect(
        match({ workModel: null, description, location: 'São Paulo, SP' }),
      ).toBe(false);
      expect(
        match(
          { workModel: null, description, location: 'São Paulo, SP' },
          'São Paulo, SP',
        ),
      ).toBe(true);
    },
  );
  it('reads onsite work and the advertised city from the title', () => {
    expect(
      match({
        title: 'Desenvolvedor — Presencial em São Paulo/SP',
        workModel: null,
        location: null,
      }),
    ).toBe(false);
    expect(
      match({
        title: 'Desenvolvedor — Presencial em Uberlândia/MG',
        workModel: null,
        location: null,
      }),
    ).toBe(true);
  });
  it('does not let a remote flag bypass an explicit onsite requirement', () => {
    expect(
      match({
        workModel: 'remoto',
        description: 'Modalidade: presencial em São Paulo/SP.',
      }),
    ).toBe(false);
  });
  it('keeps the state attached to the city when the state is written in full', () => {
    expect(
      match(
        { workModel: 'presencial', location: 'Bom Jesus, Piauí, Brasil' },
        'Bom Jesus, Rio Grande do Sul',
      ),
    ).toBe(false);
    expect(
      match({
        workModel: 'presencial',
        location: 'Uberlândia, Minas Gerais, Brasil',
      }),
    ).toBe(true);
  });
  it('requires evidence for remote-only and onsite-only selections', () => {
    const unknown = job({
      workModel: null,
      description: null,
      location: 'Curitiba, PR, Brasil',
    });
    expect(
      matches(
        unknown,
        { ...defaultJobPreferences, workModels: ['remoto'] },
        now,
        'Uberlândia, Minas Gerais',
      ),
    ).toBe(false);
    expect(
      matches(
        { ...unknown, location: 'Uberlândia, MG' },
        { ...defaultJobPreferences, workModels: ['presencial'] },
        now,
        'Uberlândia, Minas Gerais',
      ),
    ).toBe(false);
    expect(
      matches(
        { ...unknown, description: 'Trabalho 100% remoto em todo o Brasil.' },
        { ...defaultJobPreferences, workModels: ['remoto'] },
        now,
        'Uberlândia, Minas Gerais',
      ),
    ).toBe(true);
  });
  it('does not infer a local requirement from benefits or hybrid mobile development', () => {
    const remote = job({
      title: 'Desenvolvedor mobile híbrido',
      workModel: 'remoto',
      description:
        'Vale Transporte (para vagas Híbridas ou Presencial). Seja presencial ou remoto, promovemos conexões reais.',
    });
    expect(
      matches(
        remote,
        { ...defaultJobPreferences, workModels: ['remoto'] },
        now,
        'Uberlândia, MG',
      ),
    ).toBe(true);
  });
  it('does not impose a conditional São Paulo office day on a remote candidate elsewhere', () => {
    expect(
      match({
        description:
          'Profissionais fora de SP: 100% home office\nProfissionais residentes em SP: Presencial 1x por semana.',
      }),
    ).toBe(true);
  });
  it('keeps remote jobs even when the company is located elsewhere', () => {
    expect(
      match({
        description:
          'Nossa sede fica em São Paulo. Trabalho remoto em todo o Brasil.',
      }),
    ).toBe(true);
  });
  it.each([
    'É obrigatório residir em São Paulo.',
    'Necessário morar em São Paulo/SP.',
    'Residir em São Paulo e região.',
    'Residentes em São Paulo ou região.',
    'Candidates must be based in São Paulo.',
    'You must reside in São Paulo.',
    'Residência obrigatória em São Paulo.',
    'É necessário que resida em São Paulo.',
  ])('rejects incompatible mandatory residence: %s', (description) => {
    expect(match({ description })).toBe(false);
  });
  it.each([
    'Residir em Uberlândia, MG.',
    'Necessário residir em Uberlandia/MG.',
    'Residir em Uberlândia ou São Paulo.',
    'Residir em São Paulo ou Uberlândia.',
    'Residir em São Paulo/SP, Uberlândia/MG.',
    'Residir no estado de Minas Gerais.',
    'Residir no Brasil.',
  ])('keeps compatible residence: %s', (description) => {
    expect(match({ description })).toBe(true);
  });
  it.each([
    'Não é necessário residir em São Paulo.',
    'Não precisa morar em São Paulo.',
    'Desejável residir em São Paulo.',
    'Preferencialmente residir em São Paulo.',
    'Candidates are not required to reside in São Paulo.',
  ])(
    'does not treat optional or waived residence as mandatory: %s',
    (description) => {
      expect(match({ description })).toBe(true);
    },
  );
  it.each(['presencial', 'hibrido'] as const)(
    'rejects %s in another city',
    (workModel) => {
      expect(match({ workModel })).toBe(false);
      expect(match({ workModel, location: 'Uberlândia, MG' })).toBe(true);
    },
  );
  it('normalizes accents, state names and city formats', () => {
    expect(
      match({ workModel: 'presencial', location: 'Belo Horizonte, MG' }),
    ).toBe(false);
    expect(
      match(
        { workModel: 'presencial', location: 'Uberlandia/MG' },
        'Uberlândia, Minas Gerais, Brasil',
      ),
    ).toBe(true);
    expect(
      match(
        { workModel: 'hibrido', location: 'Uberlândia - MG' },
        'Uberlandia MG',
      ),
    ).toBe(true);
  });
  it('supports multiple cities and rejects matching city names in different states', () => {
    expect(
      match({
        workModel: 'presencial',
        location: 'São Paulo/SP, Uberlândia/MG',
      }),
    ).toBe(true);
    expect(
      match(
        { workModel: 'presencial', location: 'Bom Jesus/PI' },
        'Bom Jesus, RS',
      ),
    ).toBe(false);
  });
  it('detects explicit local work in descriptions with missing modality', () => {
    expect(
      match({
        workModel: null,
        description: 'Modalidade: presencial',
        location: 'São Paulo/SP',
      }),
    ).toBe(false);
    expect(
      match({
        workModel: null,
        description: 'Modelo de trabalho: híbrido em São Paulo.',
      }),
    ).toBe(false);
    expect(
      match({ workModel: null, description: 'Vaga presencial em Uberlândia.' }),
    ).toBe(true);
  });
  it('reads requirements as well as descriptions', () => {
    expect(match({ requirements: ['Residir em São Paulo'] })).toBe(false);
  });
  it('keeps unknown locations and does not invent a missing profile city', () => {
    expect(match({ workModel: 'presencial', location: null })).toBe(false);
    expect(match({ description: 'Residir em São Paulo' }, null)).toBe(true);
    expect(match({ description: 'Residir na região', location: null })).toBe(
      true,
    );
  });
  it('requires a matching city for on-site jobs, not merely a matching state or country', () => {
    for (const location of [
      null,
      'MG',
      'Minas Gerais',
      'Brasil',
      'São Paulo/SP ou região não informada',
    ])
      expect(match({ workModel: 'presencial', location })).toBe(false);
    expect(
      match({ workModel: 'presencial', location: 'Uberlândia/MG' }, null),
    ).toBe(false);
    expect(
      match(
        { workModel: 'presencial', location: 'Uberlândia/MG' },
        'Minas Gerais',
      ),
    ).toBe(false);
    expect(
      match({
        workModel: null,
        description: 'Vaga presencial',
        location: null,
      }),
    ).toBe(false);
    expect(match({ workModel: 'presencial', location: 'Uberlândia/MG' })).toBe(
      true,
    );
  });
  it('uses the advertised city for explicit residence in the job region', () => {
    expect(
      match({ description: 'É necessário residir na região da vaga.' }),
    ).toBe(false);
  });
  it('filters per profile, without depending on the source cache', () => {
    const candidateJob = { description: 'Residir em São Paulo' };
    expect(match(candidateJob, 'Uberlândia, MG')).toBe(false);
    expect(match(candidateJob, 'São Paulo, SP')).toBe(true);
  });
});
