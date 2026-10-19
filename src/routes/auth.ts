import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { HttpError } from '../errors/http-error.js';
import { LoginBodySchema, LoginResponseSchema } from '../schemas/auth.js';
import { ProblemResponse } from '../schemas/problem.js';

/** Same signature as `login` in assets/auth.ts, so tests can pass a fast fake. */
export type LoginFn = (
  email: string,
  password: string,
) => Promise<{ token: string; user: AuthenticatedUser }>;

export const authRoutes: FastifyPluginCallbackTypebox<{ login: LoginFn }> = (
  app,
  { login },
  done,
) => {
  app.post(
    '/auth/login',
    {
      // Login has its own limit, 10 a minute, to slow down password guessing.
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for a Bearer token',
        body: LoginBodySchema,
        response: {
          200: LoginResponseSchema,
          400: ProblemResponse,
          401: ProblemResponse,
          429: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request) => {
      try {
        return await login(request.body.email, request.body.password);
      } catch (error) {
        // The mock signals bad credentials with this message; anything else is a real failure.
        if (error instanceof Error && error.message === 'Invalid credentials') {
          throw new HttpError(401, 'Invalid credentials');
        }
        throw error;
      }
    },
  );
  done();
};
