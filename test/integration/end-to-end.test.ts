import { describe, expect, it } from 'vitest';
import { login } from '../../assets/auth.js';
import { MockTokenVerifier } from '../../src/auth/token-verifier.js';
import { buildTestApp } from '../test-app.js';

// Uses the real mock login and verifier, including their random delays (up to ~2.5s in total).
describe('end to end with the provided mock auth', () => {
  it('logs in, then searches with the returned token', { timeout: 10_000 }, async () => {
    const app = await buildTestApp({ login, tokenVerifier: new MockTokenVerifier() });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'jane@example.com', password: 'secret' },
    });
    expect(loginResponse.statusCode).toBe(200);
    const { token } = loginResponse.json<{ token: string }>();

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/v1/facilities?q=harbour',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json()).toMatchObject({
      data: [{ id: 'facility-003', name: 'Harbour View Wellness' }],
    });

    await app.close();
  });
});
