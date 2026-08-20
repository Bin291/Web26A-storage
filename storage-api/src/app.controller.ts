import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Health check công khai (không cần JWT). */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'storage-api', time: new Date().toISOString() };
  }

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
