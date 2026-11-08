import { fetchPublicPage } from './safe-fetch';
afterEach(() => jest.restoreAllMocks());
it('preserves the HTTP status used by availability checks without returning error content', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('gone', { status: 410 }));
  await expect(
    fetchPublicPage('https://8.8.8.8/job', { timeoutMs: 100 }),
  ).rejects.toMatchObject({ status: 410 });
});
it('keeps redirect validation when a per-request timeout is configured', async () => {
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/job' },
    }),
  );
  await expect(
    fetchPublicPage('https://8.8.8.8/job', { timeoutMs: 100 }),
  ).rejects.toThrow('Endereço não permitido');
  expect(request).toHaveBeenCalledTimes(1);
});
