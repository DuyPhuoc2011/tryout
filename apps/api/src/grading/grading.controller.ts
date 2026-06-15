import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { GradingService } from './grading.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs/:id')
@UseGuards(JwtAuthGuard)
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Post('grade')
  grade(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.grading.requestGrade(id, user.sub);
  }

  @Get('scorecard')
  scorecard(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.grading.getScorecard(id, user.sub);
  }
}
