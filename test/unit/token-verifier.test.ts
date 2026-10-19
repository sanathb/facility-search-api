import { describe, expect, it } from 'vitest';
import { InvalidTokenError, MockTokenVerifier } from '../../src/auth/token-verifier.js';
import { mockToken, TEST_USER } from '../helpers.js';

const NOW = 1_700_000_000_000;
const clock = () => NOW;

/** Decodes like the mock's verifyToken (returns payload.user), without its random delay. */
const decodeLikeMock = (token: string): Promise<unknown> => {
  const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { user?: unknown };
  return Promise.resolve(payload.user);
};

const verifier = new MockTokenVerifier(decodeLikeMock, clock);

describe('MockTokenVerifier', () => {
  it('returns the user for a valid, unexpired token', async () => {
    const token = mockToken({ user: TEST_USER, exp: NOW + 60_000 });
    await expect(verifier.verify(token)).resolves.toEqual(TEST_USER);
  });

  it('rejects an expired token', async () => {
    const token = mockToken({ user: TEST_USER, exp: NOW - 1 });
    await expect(verifier.verify(token)).rejects.toThrow('Token has expired');
  });

  it('rejects a token that expires exactly now', async () => {
    const token = mockToken({ user: TEST_USER, exp: NOW });
    await expect(verifier.verify(token)).rejects.toThrow('Token has expired');
  });

  it('rejects a token with no expiry', async () => {
    const token = mockToken({ user: TEST_USER });
    await expect(verifier.verify(token)).rejects.toThrow('Token has no expiry');
  });

  it('rejects an empty payload, which the mock resolves to undefined', async () => {
    await expect(verifier.verify(mockToken({}))).rejects.toThrow('no valid user');
  });

  it('rejects a user with an unknown membership type', async () => {
    const token = mockToken({ user: { ...TEST_USER, membershipType: 'gold' }, exp: NOW + 60_000 });
    await expect(verifier.verify(token)).rejects.toThrow('no valid user');
  });

  it('wraps decoding failures in InvalidTokenError', async () => {
    await expect(verifier.verify('not-a-token')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('MockTokenVerifier with the real mock verifyToken', () => {
  const realVerifier = new MockTokenVerifier();

  it('closes the empty-payload gap', async () => {
    await expect(realVerifier.verify(mockToken({}))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('closes the expiry gap', async () => {
    const expired = mockToken({ user: TEST_USER, exp: Date.now() - 1000 });
    await expect(realVerifier.verify(expired)).rejects.toThrow('Token has expired');
  });
});
