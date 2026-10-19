import {
  type AuthenticatedUser,
  InvalidTokenError,
  type TokenVerifier,
} from '../src/auth/token-verifier.js';
import type { Facility } from '../src/domain/facility.js';

export function facility(id: string, name: string, amenities: string[] = []): Facility {
  return {
    id,
    name,
    address: `${id} Test St`,
    location: { latitude: -33.87, longitude: 151.21 },
    amenities,
  };
}

export const TEST_USER: AuthenticatedUser = {
  id: 'user-123',
  email: 'jane@example.com',
  name: 'Jane Doe',
  membershipType: 'premium',
  memberSince: '2024-01-15',
};

export const VALID_TOKEN = 'valid-test-token';
export const AUTH_HEADER = { authorization: `Bearer ${VALID_TOKEN}` };

/** Builds a token in the mock's format: base64 header, base64 JSON payload, fake signature. */
export function mockToken(payload: unknown): string {
  return [
    btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify(payload)),
    'mock-signature',
  ].join('.');
}

/** Accepts only VALID_TOKEN, instantly, so tests don't wait on the mock's random delay. */
export const fakeVerifier: TokenVerifier = {
  verify: (token) =>
    token === VALID_TOKEN
      ? Promise.resolve(TEST_USER)
      : Promise.reject(new InvalidTokenError('Unknown test token')),
};
