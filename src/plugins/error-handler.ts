import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { STATUS_CODES } from 'node:http';

interface ValidationIssue {
  in: string;
  path: string;
  message: string;
}

/** Sends an RFC 9457 Problem Details response. */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  detail: string,
  errors?: ValidationIssue[],
): FastifyReply {
  return reply
    .status(status)
    .type('application/problem+json')
    .send({
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail,
      requestId: reply.request.id,
      ...(errors ? { errors } : {}),
    });
}

/**
 * Turns every error, and every unknown route, into a Problem Details response.
 * Register it after the rate limiter: the not-found handler uses it.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  // `unknown`, not FastifyError: a dependency can reject with anything, even undefined.
  app.setErrorHandler((thrown: unknown, request, reply) => {
    if (!(thrown instanceof Error)) {
      request.log.error({ err: thrown }, 'Unhandled non-error value');
      return sendProblem(reply, 500, 'An unexpected error occurred');
    }
    const error = thrown as FastifyError;
    if (error.validation) {
      const issues = error.validation.map((issue) => ({
        in: error.validationContext ?? 'request',
        // A missing property is reported on its parent; point at the property itself.
        path:
          issue.keyword === 'required'
            ? `${issue.instancePath}/${String(issue.params.missingProperty)}`
            : issue.instancePath,
        message: issue.message ?? 'is invalid',
      }));
      return sendProblem(reply, 400, 'Request validation failed', issues);
    }

    // Client errors keep their status and message; anything else is unexpected.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(reply, status, error.message);
    }
    // Never show internal details to clients; the log has the full error and stack trace.
    request.log.error({ err: error }, 'Unhandled error');
    return sendProblem(reply, 500, 'An unexpected error occurred');
  });

  // Rate limited like every route, so unknown URLs can't be probed without limit.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
    sendProblem(reply, 404, `Route ${request.method} ${request.url} not found`),
  );
}
