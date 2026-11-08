import { defaultJobPreferences, emptyResume } from '@recruit/shared';
import { JobService } from './job.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DiscoveryService } from './discovery/discovery.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./discovery/discovery.service', () => ({
  DiscoveryService: class {},
}));

it('passes the saved profile location into discovery, including subsequent profile changes', async () => {
  const findUnique = jest.fn().mockResolvedValue({
    resume: emptyResume,
    jobPreferences: defaultJobPreferences,
    location: 'Uberlândia, Minas Gerais',
  });
  const prisma = {
    profile: { findUnique },
    job: { findMany: jest.fn().mockResolvedValue([]) },
    dismissedJob: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const discover = jest.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    total: 0,
    exhausted: 'fim',
    failedSources: [],
    fetchMs: 0,
  });
  const service = new JobService(prisma, {
    discover,
  } as unknown as DiscoveryService);
  await service.discover({ profileId: 'candidate' });
  expect(findUnique).toHaveBeenCalledWith({
    where: { id: 'candidate' },
    select: { resume: true, jobPreferences: true, location: true },
  });
  expect(discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ profileLocation: 'Uberlândia, Minas Gerais' }),
  );
  findUnique.mockResolvedValue({
    resume: emptyResume,
    jobPreferences: defaultJobPreferences,
    location: 'São Paulo, SP',
  });
  await service.discover({ profileId: 'candidate' });
  expect(discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ profileLocation: 'São Paulo, SP' }),
  );
});
