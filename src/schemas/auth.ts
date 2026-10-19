import { Type } from 'typebox';
import { AuthenticatedUserSchema } from '../auth/token-verifier.js';

export const LoginBodySchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
});

export const LoginResponseSchema = Type.Object({
  token: Type.String(),
  user: AuthenticatedUserSchema,
});
