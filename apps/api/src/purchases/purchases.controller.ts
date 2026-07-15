import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PurchasesService } from './purchases.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly service: PurchasesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.service.checkout(user.sub, dto.listingId, dto.githubUsername);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.service.mine(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/retry-invite')
  retryInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.retryInvite(user.sub, id);
  }

  // No JWT: Stripe calls this. Authentication is the signature over the raw body.
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing webhook payload or signature');
    }
    await this.service.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
