import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SendTutorMessageDto } from './dto/send-tutor-message.dto';

@Controller('tutor')
export class TutorController {
  constructor(private readonly service: TutorService) {}

  @UseGuards(JwtAuthGuard)
  @Get(':listingId/messages')
  getThread(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.service.getThread(user.sub, listingId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':listingId/messages')
  post(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body() dto: SendTutorMessageDto,
  ) {
    return this.service.postMessage(user.sub, listingId, dto.content);
  }
}
