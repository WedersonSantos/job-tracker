import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ResumeFileService } from './resume-file.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ResumeFileService],
  exports: [ProfileService, ResumeFileService],
})
export class ProfileModule {}
