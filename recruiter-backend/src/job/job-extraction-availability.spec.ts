import { JobExtractionService } from './job-extraction.service';
import { fetchPublicPage } from './safe-fetch';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {} }));
jest.mock('./safe-fetch', () => ({
  fetchPublicPage: jest.fn(),
  FetchError: class extends Error {},
}));
it('rejects an expired pasted link before calling the extraction model', async () => {
  jest.mocked(fetchPublicPage).mockResolvedValue({
    finalUrl: 'https://www.glassdoor.com.br/job-listing/j?jl=1010294353150',
    html: '<main><p>Vaga expirada</p><h1>Security Engineer</h1></main>',
  });
  const service = new JobExtractionService({
    get: () => 'test-key',
  } as unknown as ConfigService<Env, true>);
  const ask = jest.spyOn(
    service as unknown as { ask: (text: string) => Promise<unknown> },
    'ask',
  );
  await expect(
    service.extract(
      'https://www.glassdoor.com.br/job-listing/j?jl=1010294353150',
    ),
  ).rejects.toThrow(
    'Esta vaga foi encerrada ou expirou no portal. Ela não será adicionada aos resultados.',
  );
  expect(ask).not.toHaveBeenCalled();
});
