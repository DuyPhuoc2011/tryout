import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ScenariosService } from './scenarios.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('scenarios')
@UseGuards(JwtAuthGuard)
export class ScenariosController {
  constructor(private readonly service: ScenariosService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}
