import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryFacilityRepository } from '../../src/repositories/facility-repository.js';
import { buildTestApp, testConfig, type TestApp } from '../test-app.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('reports status without a token', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      facilityCount: 100,
      uptimeSeconds: expect.any(Number) as number,
    });
  });

  it('is not rate limited', async () => {
    app = await buildTestApp({ config: testConfig({ rateLimit: { max: 1, windowMs: 60_000 } }) });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/health' })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200]);
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI 3.1 document with the Bearer security scheme', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    }>();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty('/health');
    expect(document.components.securitySchemes).toHaveProperty('bearerAuth');
  });
});

describe('error handling', () => {
  it('returns Problem Details for an unknown route', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Route GET /nope not found',
    });
  });

  it('rate limits unknown routes', async () => {
    app = await buildTestApp({ config: testConfig({ rateLimit: { max: 2, windowMs: 60_000 } }) });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await app.inject({ method: 'GET', url: `/nope${i}` })).statusCode);
    }
    expect(statuses).toEqual([404, 404, 429]);
  });

  it('returns Problem Details for a malformed URL', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health%zz' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.json()).toMatchObject({ detail: 'Malformed URL' });
  });

  it('hides unexpected failures behind a generic 500', async () => {
    const repository = new InMemoryFacilityRepository([]);
    // A dependency might reject with anything, not just an Error.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    repository.count = () => Promise.reject(undefined);
    app = await buildTestApp({ repository });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({ detail: 'An unexpected error occurred' });
  });

  it('treats a non-4xx status on an error as unexpected', async () => {
    const repository = new InMemoryFacilityRepository([]);
    repository.count = () => Promise.reject(Object.assign(new Error('moved'), { statusCode: 302 }));
    app = await buildTestApp({ repository });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('moved');
  });
});

describe('request ids', () => {
  it('echoes a well-formed incoming x-request-id', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'trace-abc.123' },
    });
    expect(response.headers['x-request-id']).toBe('trace-abc.123');
    expect(response.json()).toMatchObject({ requestId: 'trace-abc.123' });
  });

  it('replaces a malformed x-request-id with a UUID', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers and CORS', () => {
  it('sets security headers on responses', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('sends no CORS headers unless origins are configured', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows configured origins', async () => {
    app = await buildTestApp({ config: testConfig({ corsOrigins: ['https://app.example.com'] }) });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });
});
