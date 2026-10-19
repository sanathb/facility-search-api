import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Config } from './config.js';
import { registerErrorHandler, sendProblem } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { registerSwagger } from './plugins/swagger.js';
import type { FacilityRepository } from './repositories/facility-repository.js';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
  config: Config;
  repository: FacilityRepository;
}

const BODY_LIMIT_BYTES = 10 * 1024;
/** Requests Fastify's router rejects before any hook runs, and what to tell the client. */
const ROUTER_ERRORS: Record<string, string> = {
  FST_ERR_BAD_URL: 'Malformed URL',
  FST_ERR_MAX_PARAM_LENGTH: 'Path parameter too long',
};
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Builds the Fastify app from its dependencies without starting a server.
 * server.ts passes the real ones; tests pass fakes and call `app.inject()`.
 */
export async function buildApp({ config, repository }: AppDependencies) {
  const app = Fastify({
    logger: loggerOptions(config),
    // Only listed proxies are trusted, so a client can't pick its own IP with X-Forwarded-For.
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: requestIdFor,
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      // Load balancers poll /health constantly; logging each poll would drown real traffic.
      disableRequestLogging: (request) => request.routeOptions.url === '/health',
    }),
    // The router rejects a malformed URL or an over-long path parameter before any hook or the
    // error handler runs (so no rate limit or security headers either). Answer with Problem
    // Details like every other error; anything else Fastify reports here is unexpected.
    frameworkErrors: (error, request, reply) => {
      reply.header('x-request-id', request.id);
      const detail = ROUTER_ERRORS[error.code];
      if (detail === undefined) {
        request.log.error({ err: error }, 'Unexpected framework error');
      } else {
        // Fastify writes no "request completed" line for these replies, so record the outcome.
        request.log.info({ code: error.code, statusCode: 400 }, 'Request rejected by the router');
      }
      void sendProblem(reply, detail ? 400 : 500, detail ?? 'An unexpected error occurred');
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    done();
  });

  await registerSecurity(app, config);
  registerErrorHandler(app);
  await registerSwagger(app);

  await app.register(healthRoutes, { repository });

  return app;
}

/** Reuses a well-formed incoming x-request-id so one request can be traced across services. */
function requestIdFor(request: IncomingMessage): string {
  const incoming = request.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // Fastify doesn't log headers by default; this keeps tokens out of logs if that ever changes.
    redact: ['req.headers.authorization'],
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}
