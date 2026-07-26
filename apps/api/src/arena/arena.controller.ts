import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EnvironmentsService } from './environments.service';
import { TurnsService } from './turns.service';
import { SubmitTurnDto } from './dto/submit-turn.dto';

@Controller('arena')
@UseGuards(JwtAuthGuard)
export class ArenaController {
  constructor(
    private readonly environments: EnvironmentsService,
    private readonly turns: TurnsService,
  ) {}

  @Get('environments/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.environments.mine(user.sub);
  }

  @Post('environments/:listingId')
  create(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    return this.environments.create(user.sub, listingId);
  }

  @Post('environments/:environmentId/turns')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @Body() dto: SubmitTurnDto,
  ) {
    return this.turns.submit(user.sub, environmentId, dto.design);
  }
}
