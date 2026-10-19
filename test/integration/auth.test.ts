import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_USER, VALID_TOKEN } from '../helpers.js';
import { buildTestApp, type TestApp } from '../test-app.js';

let app: TestApp;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

function login(target: TestApp, payload: Record<string, unknown>) {
  return target.inject({ method: 'POST', url: '/v1/auth/login', payload });
}

describe('POST /v1/auth/login', () => {
  it('returns a token and the user', async () => {
    const response = await login(app, { email: 'jane@example.com', password: 'secret' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ token: VALID_TOKEN, user: TEST_USER });
  });

  it('rejects an invalid email address', async () => {
    const response = await login(app, { email: 'not-an-email', password: 'secret' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ in: 'body', path: '/email' }] });
  });

  it('rejects an email with non-Latin-1 characters', async () => {
    // Keeps such input away from the mock's btoa(), which would throw and cause a 500.
    const response = await login(app, { email: '用户@example.com', password: 'secret' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ in: 'body', path: '/email' }] });
  });

  it('rejects a missing password', async () => {
    const response = await login(app, { email: 'jane@example.com' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ in: 'body', path: '/password' }] });
  });

  it('returns 401 when the credentials are rejected', async () => {
    const response = await login(app, { email: 'jane@example.com', password: 'error' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ status: 401, detail: 'Invalid credentials' });
  });

  it('returns a generic 500 when login fails unexpectedly', async () => {
    const failing = await buildTestApp({
      login: () => Promise.reject(new Error('identity provider timed out')),
    });
    const response = await login(failing, { email: 'jane@example.com', password: 'secret' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ detail: 'An unexpected error occurred' });
    expect(response.body).not.toContain('identity provider');
    await failing.close();
  });

  it('allows 10 attempts per minute from one client', async () => {
    const limited = await buildTestApp();
    for (let i = 0; i < 10; i++) {
      const response = await login(limited, { email: 'jane@example.com', password: 'secret' });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await login(limited, { email: 'jane@example.com', password: 'secret' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await limited.close();
  });

  it('is documented in the OpenAPI document, with Problem Details errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.json()).toMatchObject({
      paths: {
        '/v1/auth/login': {
          post: { responses: { '401': { content: { 'application/problem+json': {} } } } },
        },
      },
    });
  });
});
