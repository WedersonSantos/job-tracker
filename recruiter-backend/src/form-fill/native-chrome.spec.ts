import {
  parseChromeProfiles,
  parseLastUsedChromeProfile,
  lastUsedChromeProfile,
} from './chrome-profiles';
import { NativeChromeService, serializePlan } from './native-chrome.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResumeFileService } from '../profile/resume-file.service';
import { openChromeProfile } from './chrome-profiles';
import { assertReachable } from '../job/safe-fetch';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./chrome-profiles', () => ({
  ...jest.requireActual<typeof import('./chrome-profiles')>(
    './chrome-profiles',
  ),
  openChromeProfile: jest.fn().mockResolvedValue(undefined),
  lastUsedChromeProfile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../job/safe-fetch', () => ({
  assertReachable: jest.fn().mockResolvedValue(undefined),
}));
const profile = {
  name: 'Carlos Silva',
  email: 'test@example.com',
  phone: null,
  location: 'Uberlândia, MG',
  links: {},
  resume: {},
  formFillDefaults: {},
};
const prisma = {
  profile: { findUnique: jest.fn().mockResolvedValue(profile) },
} as unknown as PrismaService;
const files = {
  attachment: jest.fn().mockResolvedValue(null),
} as unknown as ResumeFileService;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(lastUsedChromeProfile).mockResolvedValue(undefined);
  jest.mocked(assertReachable).mockResolvedValue(undefined);
});
it('lists only profile identifiers and display names, ignoring account and session data', () => {
  expect(
    parseChromeProfiles(
      JSON.stringify({
        os_crypt: { encrypted_key: 'not returned' },
        profile: {
          info_cache: {
            Default: { name: 'Seu Chrome', user_name: 'private@example.com' },
            'Profile 1': { name: 'Carlos' },
            '../other': { name: 'other' },
            'Guest Profile': { name: 'Guest' },
          },
        },
      }),
    ),
  ).toEqual([
    { id: 'Default', name: 'Seu Chrome' },
    { id: 'Profile 1', name: 'Carlos' },
  ]);
  expect(parseChromeProfiles('null')).toEqual([]);
});
it('serializes label matching without losing the expression flags', () => {
  expect(
    serializePlan([
      { what: 'nome', value: 'Carlos', labels: /^nome completo$/i },
    ]),
  ).toEqual([
    {
      what: 'nome',
      value: 'Carlos',
      labels: '^nome completo$',
      flags: 'i',
      names: undefined,
      autocomplete: undefined,
    },
  ]);
});
it('opens the requested existing profile and exposes only request metadata before filling', async () => {
  const service = new NativeChromeService(prisma, files);
  await service.open('candidate', 'Profile 1', 'https://example.com/job');
  expect(openChromeProfile).toHaveBeenCalledWith(
    'Profile 1',
    expect.stringMatching(
      /^http:\/\/127\.0\.0\.1:3333\/form-fill\/chrome\/open\?requestId=/,
    ),
  );
  const [request] = service.requests();
  expect(Object.keys(request).sort()).toEqual(['id', 'name', 'url']);
  const plan = await service.plan(request.id, 'https://ats.example.com/apply');
  expect(plan.fields.some((f) => f.value === 'test@example.com')).toBe(true);
  expect(plan.attachment).toBeNull();
});
it.each(['Default', 'Profile 2'])(
  'automatically uses the last-used Chrome profile %s when both profiles exist',
  async (lastUsed) => {
    const service = new NativeChromeService(prisma, files);
    jest.spyOn(service, 'profiles').mockResolvedValue([
      { id: 'Profile 2', name: 'Carlos' },
      { id: 'Default', name: 'Seu Chrome' },
    ]);
    jest.mocked(lastUsedChromeProfile).mockResolvedValue(lastUsed);
    await service.open('candidate', undefined, 'https://example.com/job');
    expect(openChromeProfile).toHaveBeenCalledWith(
      lastUsed,
      expect.stringContaining('/form-fill/chrome/open?requestId='),
    );
    expect(service.requests()).toHaveLength(1);
  },
);
it('uses only validated last-used profile metadata, ignoring missing or invalid profiles', () => {
  const raw = (last_used: unknown) =>
    JSON.stringify({
      profile: {
        last_used,
        info_cache: {
          Default: { name: 'Alexandre' },
          'Profile 2': { name: 'Carlos' },
        },
      },
    });
  expect(parseLastUsedChromeProfile(raw('Profile 2'))).toBe('Profile 2');
  expect(parseLastUsedChromeProfile(raw('Default'))).toBe('Default');
  for (const id of ['Profile 99', '../other', 'Guest Profile', null, 2])
    expect(parseLastUsedChromeProfile(raw(id))).toBeUndefined();
  expect(parseLastUsedChromeProfile('null')).toBeUndefined();
});
it('automatically uses another registered profile when Default is absent', async () => {
  const service = new NativeChromeService(prisma, files);
  jest
    .spyOn(service, 'profiles')
    .mockResolvedValue([{ id: 'Profile 2', name: 'Carlos' }]);
  await service.open('candidate', undefined, 'https://example.com/job');
  expect(openChromeProfile).toHaveBeenCalledWith(
    'Profile 2',
    expect.stringContaining('/form-fill/chrome/open?requestId='),
  );
});
it('does not create a new browser profile when there is no existing profile', async () => {
  const service = new NativeChromeService(prisma, files);
  jest.spyOn(service, 'profiles').mockResolvedValue([]);
  await expect(
    service.open('candidate', undefined, 'https://example.com/job'),
  ).rejects.toThrow('Nenhum perfil do Chrome encontrado');
  expect(openChromeProfile).not.toHaveBeenCalled();
});
it('rejects private destinations before launching Chrome', async () => {
  jest.mocked(assertReachable).mockRejectedValue(new Error('private address'));
  await expect(
    new NativeChromeService(prisma, files).open(
      'candidate',
      'Default',
      'http://127.0.0.1/',
    ),
  ).rejects.toThrow('private');
  expect(openChromeProfile).not.toHaveBeenCalled();
});
it('expires filling requests after ten minutes', async () => {
  const service = new NativeChromeService(prisma, files);
  await service.open('candidate', 'Default', 'https://example.com/job');
  const [request] = service.requests();
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.now() + 11 * 60_000);
  try {
    await expect(
      service.plan(request.id, 'https://example.com/apply'),
    ).rejects.toThrow('expirou');
  } finally {
    clock.mockRestore();
  }
});

it('prepares a request without launching Chrome when the local extension is connected', async () => {
  const service = new NativeChromeService(prisma, files);
  const result = await service.open(
    'candidate',
    undefined,
    'https://example.com/job',
    true,
  );
  expect(openChromeProfile).not.toHaveBeenCalled();
  expect(lastUsedChromeProfile).not.toHaveBeenCalled();
  expect(service.requests()).toEqual([
    {
      id: result.requestId,
      name: profile.name,
      url: 'https://example.com/job',
    },
  ]);
});

it('renews the same candidate/job request on repeat clicks so an active filling run remains valid', async () => {
  const service = new NativeChromeService(prisma, files);
  const first = await service.open(
    'candidate',
    undefined,
    'https://example.com/job',
    true,
  );
  const again = await service.open(
    'candidate',
    undefined,
    'https://example.com/job',
    true,
  );
  expect(again.requestId).toBe(first.requestId);
  expect(service.requests()).toHaveLength(1);
});
