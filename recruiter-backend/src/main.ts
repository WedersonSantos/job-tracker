import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { rejectNonLocal } from './common/security/local-only';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  const regularJson = json({ limit: '100kb' });
  const resumeJson = json({ limit: '8mb' });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const parser = /^\/profiles\/[^/]+\/resume-file(?:\?|$)/.test(
      request.originalUrl,
    )
      ? resumeJson
      : regularJson;
    parser(request, response, next);
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  // Antes de tudo, inclusive do CORS: requisição recusada aqui não chega a
  // nenhuma rota. Ver `common/security/local-only.ts`.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const rejection = rejectNonLocal({
      host: request.headers.host,
      method: request.method,
      contentType: request.headers['content-type'],
    });

    if (!rejection) {
      next();
      return;
    }

    response.status(rejection.status).json({
      statusCode: rejection.status,
      error: rejection.error,
      message: rejection.message,
    });
  });

  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });

  const port = config.get('PORT', { infer: true });
  const host = config.get('API_HOST', { infer: true });

  // Com host explícito: o padrão do Nest é 0.0.0.0, e esta API não tem
  // autenticação. Ver `API_HOST` em config/env.ts.
  await app.listen(port, host);

  Logger.log(`Worker ouvindo em http://${host}:${port}`, 'Bootstrap');
}

void bootstrap();
