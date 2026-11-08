import { PresentationService } from './presentation.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NativeChromeService } from './native-chrome.service';
import type { AnswersService } from '../answers/answers.service';
import { emptyFormFillDefaults } from '@recruit/shared';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../answers/answers.service', () => ({ AnswersService: class {} }));

function setup() {
  const profile = {
    updatedAt: new Date('2026-10-30'),
    formFillDefaults: {
      ...emptyFormFillDefaults,
      personalizePresentation: true,
      presentationBase: 'Atuo com suporte técnico e redes.',
    },
  };
  const job = {
    id: 'job',
    company: 'Empresa A',
    title: 'Suporte técnico',
    description: 'Atendimento e redes',
    stack: ['redes'],
    requirements: [],
    updatedAt: new Date('2026-10-30'),
  };
  const prisma = {
    profile: { findUnique: jest.fn().mockResolvedValue(profile) },
    job: { findUnique: jest.fn().mockResolvedValue(job) },
  };
  const native = {
    requestContext: jest.fn().mockReturnValue({
      profileId: 'candidate',
      url: 'https://company.gupy.io/jobs/123',
    }),
    validateTarget: jest.fn().mockResolvedValue({}),
  };
  const answer = {
    draft:
      'Atuo com suporte técnico e posso contribuir com o atendimento da Empresa A.',
    facts: [{ claim: 'suporte técnico', grounded: true, source: 'resumo' }],
    unverifiedNumbers: [],
    overLimit: false,
  };
  const answers = { draft: jest.fn().mockResolvedValue(answer) };
  const service = new PresentationService(
    prisma as unknown as PrismaService,
    native as unknown as NativeChromeService,
    answers as unknown as AnswersService,
  );
  const poll = () =>
    service.draft(
      'request',
      'https://company.gupy.io/candidates/applications/123/curriculum',
      1500,
    );
  return { profile, job, prisma, native, answers, answer, service, poll };
}

it('uses the correct saved vacancy and CV base, caches a paid generation across polling and repeat clicks', async () => {
  const h = setup();
  expect(await h.poll()).toEqual({ status: 'pending' });
  expect(await h.poll()).toEqual({ status: 'ready', text: h.answer.draft });
  await h.poll();
  expect(h.answers.draft).toHaveBeenCalledTimes(1);
  expect(h.answers.draft).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: 'candidate',
      jobId: 'job',
      notes: h.profile.formFillDefaults.presentationBase,
      mode: 'draft',
      maxChars: 1500,
    }),
  );
  expect(h.prisma.job.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { url: 'https://company.gupy.io/jobs/123' },
    }),
  );
});
it('uses the resume through the existing answer engine when no presentation base was configured', async () => {
  const h = setup();
  h.profile.formFillDefaults.presentationBase = '';
  await h.poll();
  expect(h.answers.draft).toHaveBeenCalledWith(
    expect.objectContaining({ notes: undefined, profileId: 'candidate' }),
  );
});

it('does not send demographic defaults or CID to the presentation AI', async () => {
  const h = setup();
  h.profile.formFillDefaults.disabilityStatus = 'Sim';
  h.profile.formFillDefaults.disabilityCid = 'PRIVATE-TEST-CID';
  h.profile.formFillDefaults.sexualOrientation = 'Bissexual';
  await h.poll();
  const request = JSON.stringify(h.answers.draft.mock.calls[0]);
  expect(request).not.toContain('PRIVATE-TEST-CID');
  expect(request).not.toContain('Bissexual');
});
it('requires the presentation opt-in and stored vacancy context before calling the AI', async () => {
  const h = setup();
  h.profile.formFillDefaults.personalizePresentation = false;
  await expect(h.poll()).rejects.toThrow('Ative');
  h.profile.formFillDefaults.personalizePresentation = true;
  h.prisma.job.findUnique.mockResolvedValue(null);
  await expect(h.poll()).rejects.toThrow('descrição');
  expect(h.answers.draft).not.toHaveBeenCalled();
});
it.each(['limit', 'grounding', 'numbers', 'empty facts'])(
  'does not autofill an unsafe AI draft: %s',
  async (scenario) => {
    const h = setup();
    if (scenario === 'limit') h.answer.draft = 'a'.repeat(1501);
    if (scenario === 'grounding') h.answer.facts[0].grounded = false;
    if (scenario === 'numbers')
      (h.answer.unverifiedNumbers as string[]).push('10');
    if (scenario === 'empty facts') h.answer.facts = [];
    await h.poll();
    expect(await h.poll()).toMatchObject({ status: 'error' });
  },
);
it('reports AI configuration/network failure instead of inserting a generic or fabricated answer', async () => {
  const h = setup();
  h.answers.draft.mockRejectedValue(new Error('Configure a API de IA.'));
  await h.poll();
  await Promise.resolve();
  expect(await h.poll()).toEqual({
    status: 'error',
    message: 'Configure a API de IA.',
  });
});
it('invalidates the cached draft when the curriculum changes and rejects unrelated hosts or expired requests', async () => {
  const h = setup();
  await h.poll();
  h.profile.updatedAt = new Date('2026-10-31');
  await h.poll();
  expect(h.answers.draft).toHaveBeenCalledTimes(2);
  await expect(
    h.service.draft('request', 'https://other.example/', 1500),
  ).rejects.toThrow('Gupy');
  h.native.requestContext.mockImplementation(() => {
    throw new Error('Pedido expirou');
  });
  await expect(h.poll()).rejects.toThrow('expirou');
  expect(h.answers.draft).toHaveBeenCalledTimes(2);
});
