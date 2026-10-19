import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { verifyToken } from '../../assets/auth.js';

export const AuthenticatedUserSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  email: Type.String({ minLength: 1 }),
  name: Type.String(),
  membershipType: Type.Enum(['basic', 'premium', 'elite']),
  memberSince: Type.String(),
});

export type AuthenticatedUser = Static<typeof AuthenticatedUserSchema>;

const authenticatedUser = Compile(AuthenticatedUserSchema);

/** Any reason a token is rejected. The reason is for logs only, never for the client. */
export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';
}

export interface TokenVerifier {
  /** Resolves with the token's user, or rejects with InvalidTokenError. */
  verify(token: string): Promise<AuthenticatedUser>;
}

/**
 * Wraps the provided mock `verifyToken` and closes the gaps it leaves:
 * - a payload without `user` (e.g. `{}`) resolves to undefined instead of failing;
 * - `exp` is never checked.
 * It still cannot check the signature, because the mock doesn't sign tokens.
 */
export class MockTokenVerifier implements TokenVerifier {
  constructor(
    private readonly verifyFn: (token: string) => Promise<unknown> = verifyToken,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(token: string): Promise<AuthenticatedUser> {
    let user: unknown;
    try {
      user = await this.verifyFn(token);
    } catch (error) {
      // The mock only throws when it can't decode the token.
      throw new InvalidTokenError('Token could not be decoded', { cause: error });
    }
    if (!authenticatedUser.Check(user)) {
      throw new InvalidTokenError('Token payload has no valid user');
    }
    const expiresAt = readExpiry(token);
    if (expiresAt === undefined) {
      throw new InvalidTokenError('Token has no expiry');
    }
    if (expiresAt <= this.now()) {
      throw new InvalidTokenError('Token has expired');
    }
    return user;
  }
}

/** Reads `exp` from the payload. The mock writes milliseconds; a real JWT uses seconds. */
function readExpiry(token: string): number | undefined {
  try {
    const payload: unknown = JSON.parse(atob(token.split('.')[1] ?? ''));
    if (typeof payload === 'object' && payload !== null && 'exp' in payload) {
      return typeof payload.exp === 'number' ? payload.exp : undefined;
    }
  } catch {
    // Unreadable payload: treated the same as a missing expiry.
  }
  return undefined;
}
