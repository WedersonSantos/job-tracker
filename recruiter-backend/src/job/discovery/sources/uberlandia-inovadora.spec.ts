import { defaultJobPreferences, jobSearchResultSchema } from '@recruit/shared';
import {
  parseUberlandiaJobs,
  UberlandiaInovadoraSource,
} from './uberlandia-inovadora';
import { fetchPublicPage } from '../../safe-fetch';
import { matches } from '../filters';
jest.mock('../../safe-fetch', () => ({ fetchPublicPage: jest.fn() }));
function card({
  title = 'Desenvolvedor Python',
  level = 'Pleno',
  type = '',
  note = '',
  href = 'https://example.com/job',
  company = 'Empresa &amp; Cia',
} = {}) {
  return `<a href="${href}" class="group bg-card"><p>Desenvolvimento</p><h3 class="line-clamp-2">${title}</h3>${note ? `<p>${note}</p>` : ''}<span class="truncate">${company}</span><span class="rounded-full bg-muted">${level}</span>${type ? `<span class="rounded-full bg-warning-soft">${type}</span>` : ''}</a>`;
}
it('imports jobs and excludes courses and scholarships by type', () => {
  const p = parseUberlandiaJobs(
    card() +
      card({ type: 'Curso', href: 'https://example.com/course' }) +
      card({ type: 'Bolsa', href: 'https://example.com/scholarship' }),
  );
  expect(p.items).toHaveLength(1);
  expect(p.nonJobs).toBe(2);
  expect(p.items[0]).toMatchObject({
    company: 'Empresa & Cia',
    seniority: 'pleno',
    source: 'uberlandia-inovadora',
  });
  expect(jobSearchResultSchema.safeParse(p.items[0]).success).toBe(true);
});
it('keeps paid internships and counts advertisements rather than positions', () => {
  const p = parseUberlandiaJobs(
    card({
      title: 'Estágio — 6 vagas',
      level: 'Estágio',
      note: 'Bolsa de R$ 4.000',
    }),
  );
  expect(p.items).toHaveLength(1);
  expect(p.items[0].seniority).toBe('junior');
  expect(p.nonJobs).toBe(0);
});
it.each([
  ['Pleno', 'pleno'],
  ['Sênior', 'senior'],
  ['Liderança', 'lead'],
  ['Especialista', 'senior'],
  ['Júnior', 'junior'],
  ['Não informado', null],
])('maps %s to the existing seniority filter', (level, seniority) => {
  expect(
    parseUberlandiaJobs(card({ title: 'Analista de Sistemas', level: level }))
      .items[0].seniority,
  ).toBe(seniority);
});
it('uses the saved Pleno preference instead of hard-coding a source level', () => {
  const items = parseUberlandiaJobs(
    card() + card({ level: 'Sênior', href: 'https://example.com/senior' }),
  ).items;
  expect(
    items.filter((job) =>
      matches(job, { ...defaultJobPreferences, seniorities: ['pleno'] }),
    ),
  ).toHaveLength(1);
});
it('detects home office without inventing a city from the portal name', () => {
  const job = parseUberlandiaJobs(card({ note: '100% Home Office' })).items[0];
  expect(job.workModel).toBe('remoto');
  expect(job.location).toBeNull();
});
it('recognizes explicit local information and rejects on-site jobs without a city', () => {
  const job = parseUberlandiaJobs(card({ note: 'PJ · Híbrido em Uberlândia' }))
    .items[0];
  expect(job.location).toBe('Uberlândia, MG');
  expect(job.workModel).toBe('hibrido');
  expect(
    matches(
      parseUberlandiaJobs(card({ note: 'Presencial' })).items[0],
      defaultJobPreferences,
      new Date(),
      'Uberlândia, MG',
    ),
  ).toBe(false);
});
it('does not invent dates or salary amounts from stipend notes', () => {
  const job = parseUberlandiaJobs(card({ note: 'Bolsa de R$ 4.000' })).items[0];
  expect(job.postedAt).toBeNull();
  expect(job.salaryMin).toBeNull();
});
it('deduplicates links and reports email and invalid links without opening them', () => {
  const p = parseUberlandiaJobs(
    card() +
      card() +
      card({ href: 'mailto:jobs@example.com' }) +
      card({ href: 'javascript:alert(1)' }) +
      card({ href: '' }),
  );
  expect(p.items).toHaveLength(1);
  expect(p.withoutWebLink).toBe(3);
});
it('ignores featured cards and reports changed layouts', () => {
  expect(
    parseUberlandiaJobs(card() + '<a class="bg-card"><h3>Featured</h3></a>')
      .items,
  ).toHaveLength(1);
  expect(() => parseUberlandiaJobs('<html>No cards</html>')).toThrow('formato');
});
it('fetches one listing and reports unsupported entries', async () => {
  jest.mocked(fetchPublicPage).mockResolvedValue({
    html: card() + card({ href: 'mailto:jobs@example.com' }),
    finalUrl: 'https://uberlandiainovadora.com.br/vagas',
  });
  const source = new UberlandiaInovadoraSource();
  expect(await source.fetch()).toHaveLength(1);
  expect(source.issues[0]).toContain('1 anúncios sem link web');
  expect(fetchPublicPage).toHaveBeenCalledWith(
    'https://uberlandiainovadora.com.br/vagas',
  );
});
