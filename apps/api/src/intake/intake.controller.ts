import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { SendIntakeMessageDto } from './dto/send-intake-message.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('intake')
@UseGuards(JwtAuthGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post()
  start(@CurrentUser() user: AuthUser) {
    return this.intake.startOrResume(user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.intake.getSession(id, user.sub);
  }

  @Post(':id/messages')
  send(
    @Param('id') id: string,
    @Body() dto: SendIntakeMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.intake.sendTurn(id, user.sub, dto.content);
  }

  @Post(':id/place')
  place(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.intake.place(id, user.sub);
  }
}
