import { Body, Controller, Post, Query, Get, Header } from '@nestjs/common';
import { z } from 'zod';
import { externalUrlSchema } from '@recruit/shared';
import { NativeChromeService } from './native-chrome.service';
import { PresentationService } from './presentation.service';
import { fillFormSchema, type FillFormInput } from '@recruit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProfileExistsPipe } from '../common/pipes/profile-exists.pipe';
import { FormFillService, type FillReport } from './form-fill.service';

@Controller('form-fill')
export class FormFillController {
  constructor(
    private readonly formFill: FormFillService,
    private readonly nativeChrome: NativeChromeService,
    private readonly presentations: PresentationService,
  ) {}

  @Get('chrome-profiles')
  chromeProfiles() {
    return this.nativeChrome.profiles();
  }

  @Post('chrome')
  openChrome(
    @Query('profileId', ProfileExistsPipe) profileId: string,
    @Body(
      new ZodValidationPipe(
        z.strictObject({
          url: externalUrlSchema,
          prepareOnly: z.boolean().optional(),
          chromeProfile: z
            .string()
            .regex(/^(Default|Profile \d+)$/)
            .optional(),
        }),
      ),
    )
    input: { url: string; chromeProfile?: string; prepareOnly?: boolean },
  ) {
    return this.nativeChrome.open(
      profileId,
      input.chromeProfile,
      input.url,
      input.prepareOnly,
    );
  }

  @Get('chrome/open')
  @Header('Content-Type', 'text/html; charset=utf-8')
  chromeHandoff() {
    return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Job Tracker</title><body><h1>Abrindo candidatura…</h1><p>A extensão Job Tracker encontrará a aba da vaga. Se esta tela permanecer aberta, recarregue a extensão em chrome://extensions e atualize esta página.</p></body></html>';
  }

  @Get('chrome/pending')
  pending() {
    return this.nativeChrome.requests();
  }

  @Post('chrome/validate-target')
  validateTarget(
    @Body(new ZodValidationPipe(z.strictObject({ url: externalUrlSchema })))
    input: {
      url: string;
    },
  ) {
    return this.nativeChrome.validateTarget(input.url);
  }

  @Post('chrome/plan')
  chromePlan(
    @Body(
      new ZodValidationPipe(
        z.strictObject({ requestId: z.uuid(), url: externalUrlSchema }),
      ),
    )
    input: {
      requestId: string;
      url: string;
    },
  ) {
    return this.nativeChrome.plan(input.requestId, input.url);
  }

  @Post('chrome/presentation')
  presentation(
    @Body(
      new ZodValidationPipe(
        z.strictObject({
          requestId: z.uuid(),
          url: externalUrlSchema,
          maxChars: z.number().int().min(50).max(4000),
        }),
      ),
    )
    input: {
      requestId: string;
      url: string;
      maxChars: number;
    },
  ) {
    return this.presentations.draft(input.requestId, input.url, input.maxChars);
  }

  @Post()
  fill(
    @Query('profileId', ProfileExistsPipe) profileId: string,
    @Body(new ZodValidationPipe(fillFormSchema)) input: FillFormInput,
  ): Promise<FillReport> {
    return this.formFill.fill(profileId, input.url);
  }
}
