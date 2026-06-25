import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntakeService, type UploadedCv } from './intake.service';
import { SendIntakeMessageDto } from './dto/send-intake-message.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const MAX_CV_BYTES = 5 * 1024 * 1024; // 5MB

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

  @Post(':id/cv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CV_BYTES } }))
  ingestCv(
    @Param('id') id: string,
    @UploadedFile() file: UploadedCv | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.intake.ingestCv(id, user.sub, file);
  }

  @Post(':id/place')
  place(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.intake.place(id, user.sub);
  }
}
