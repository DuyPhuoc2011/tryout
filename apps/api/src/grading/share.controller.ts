import { Controller, Get, Param } from '@nestjs/common';
import { GradingService } from './grading.service';

// Public, unauthenticated. The run id is an unguessable UUID that the candidate
// chooses to share; the scorecard it returns carries no PII.
@Controller('share/:runId')
export class ShareController {
  constructor(private readonly grading: GradingService) {}

  @Get('scorecard')
  scorecard(@Param('runId') runId: string) {
    return this.grading.getPublicScorecard(runId);
  }
}
