import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ScenarioRunsService } from './scenario-runs.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs')
@UseGuards(JwtAuthGuard)
export class ScenarioRunsController {
  constructor(private readonly service: ScenarioRunsService) {}

  @Post()
  start(@CurrentUser() user: AuthUser) {
    return this.service.startRun(user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getRun(id, user.sub);
  }
}
