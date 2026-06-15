import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('scenario-runs/:id/messages')
@UseGuards(JwtAuthGuard)
export class AgentChatController {
  constructor(private readonly chat: AgentChatService) {}

  @Get()
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chat.listMessages(id, user.sub);
  }

  @Post()
  send(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chat.sendMessage(id, user.sub, dto.agentRole, dto.content);
  }
}
