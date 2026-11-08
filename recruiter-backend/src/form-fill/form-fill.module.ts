import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { FormFillController } from './form-fill.controller';
import { FormFillService } from './form-fill.service';
import { NativeChromeService } from './native-chrome.service';
import { AnswersModule } from '../answers/answers.module';
import { PresentationService } from './presentation.service';

@Module({
  imports: [ProfileModule, AnswersModule],
  controllers: [FormFillController],
  providers: [FormFillService, NativeChromeService, PresentationService],
})
export class FormFillModule {}
