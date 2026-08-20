import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser: false để tự đăng ký — route /uploads/part cần raw octet-stream (mục 5.A).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  const chunkSizeMb = config.get<number>('limits.chunkSizeMb') ?? 8;
  // Cho phép chunk + overhead; gấp đôi chunk size để dư.
  app.use('/uploads/part', raw({ type: () => true, limit: `${chunkSizeMb * 2}mb` }));
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  app.enableCors({
    origin: config.get<string[]>('webOrigin') ?? ['http://localhost:4200'],
    credentials: true,
    exposedHeaders: ['ETag'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`storage-api đang chạy ở http://localhost:${port}`);
}
void bootstrap();
