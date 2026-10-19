import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  type AuthenticatedUser,
  InvalidTokenError,
  type TokenVerifier,
} from '../auth/token-verifier.js';
import { HttpError } from '../errors/http-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user; set by the authenticate hook on protected routes. */
    user: AuthenticatedUser | null;
  }
}

const BEARER = /^Bearer +(\S+)$/i;

/** Returns the token from an `Authorization: Bearer <token>` header, or undefined. */
function parseBearerToken(header: string | undefined): string | undefined {
  return header === undefined ? undefined : BEARER.exec(header)?.[1];
}

/** Builds a hook that rejects requests without a valid Bearer token and sets `request.user`. */
export function createAuthenticate(verifier: TokenVerifier) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);
    if (token === undefined) {
      throw unauthorized(reply, 'Missing or malformed Authorization header');
    }
    try {
      request.user = await verifier.verify(token);
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) throw error;
      request.log.debug({ reason: error.message }, 'Rejected token');
      throw unauthorized(reply, 'Invalid or expired token');
    }
  };
}

function unauthorized(reply: FastifyReply, detail: string): HttpError {
  reply.header('WWW-Authenticate', 'Bearer');
  return new HttpError(401, detail);
}
