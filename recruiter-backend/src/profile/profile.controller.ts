import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  HttpCode,
} from '@nestjs/common';
import {
  uploadResumeFileSchema,
  type UploadResumeFileInput,
} from '@recruit/shared';
import { ResumeFileService } from './resume-file.service';
import { createProfileSchema, updateProfileSchema } from '@recruit/shared';
import type {
  CreateProfileInput,
  Profile,
  ProfileDetail,
  UpdateProfileInput,
} from '@recruit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProfileService } from './profile.service';

@Controller('profiles')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly resumeFiles: ResumeFileService,
  ) {}

  @Get(':id/resume-file')
  resumeFile(@Param('id') id: string) {
    return this.resumeFiles.info(id);
  }

  @Post(':id/resume-file')
  saveResumeFile(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(uploadResumeFileSchema))
    input: UploadResumeFileInput,
  ) {
    return this.resumeFiles.save(id, input);
  }

  @Delete(':id/resume-file')
  @HttpCode(204)
  removeResumeFile(@Param('id') id: string) {
    return this.resumeFiles.remove(id);
  }

  @Post(':id/resume-file/import')
  importResumeFile(@Param('id') id: string) {
    return this.resumeFiles.import(id);
  }

  @Get()
  list(): Promise<Profile[]> {
    return this.profileService.list();
  }

  @Get(':id')
  findDetailById(@Param('id') id: string): Promise<ProfileDetail> {
    return this.profileService.findDetailById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProfileSchema))
    input: UpdateProfileInput,
  ): Promise<ProfileDetail> {
    return this.profileService.update(id, input);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createProfileSchema))
    input: CreateProfileInput,
  ): Promise<Profile> {
    return this.profileService.create(input);
  }
}
