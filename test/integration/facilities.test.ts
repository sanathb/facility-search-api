import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacilities } from '../../src/data/load-facilities.js';
import { AUTH_HEADER, facility } from '../helpers.js';
import { buildTestApp, testConfig, type TestApp } from '../test-app.js';

let app: TestApp;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('authentication on facility routes', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/facilities?q=city' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing or malformed Authorization header',
    });
  });

  it('rejects a non-Bearer scheme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects an invalid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities/facility-001',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({ detail: 'Invalid or expired token' });
  });

  it('returns 500, not 401, when the verifier itself fails', async () => {
    const broken = await buildTestApp({
      tokenVerifier: { verify: () => Promise.reject(new Error('auth service unavailable')) },
    });
    const response = await broken.inject({
      method: 'GET',
      url: '/v1/facilities',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ detail: 'An unexpected error occurred' });
    await broken.close();
  });

  it('checks the token before validating input', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/facilities?limit=101' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /v1/facilities', () => {
  it('finds facilities by partial name and returns only summary fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities?q=City',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 'facility-001',
          name: 'City Fitness Central',
          address: '123 Market St, Sydney, NSW 2000',
        },
      ],
      page: { limit: 20, offset: 0, total: 1 },
    });
  });

  it('pages through every facility when there is no query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities?limit=5&offset=5',
      headers: AUTH_HEADER,
    });
    const body = response.json<{ data: unknown[]; page: unknown }>();
    expect(body.data).toHaveLength(5);
    expect(body.page).toEqual({ limit: 5, offset: 5, total: 100 });
  });

  it('filters by amenities, requiring all of them', async () => {
    const facilities = await loadFacilities('assets/facilities.json');
    const expected = facilities
      .filter((f) => f.amenities.includes('Pool') && f.amenities.includes('Sauna'))
      .map((f) => f.id)
      .sort();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities?amenities=pool,%20Sauna&limit=100',
      headers: AUTH_HEADER,
    });
    const body = response.json<{ data: { id: string }[]; page: { total: number } }>();
    expect(body.page.total).toBe(expected.length);
    expect(body.data.map((f) => f.id).sort()).toEqual(expected);
  });

  it('rejects a limit above 100 with Problem Details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities?limit=101',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Request validation failed',
      requestId: expect.any(String) as string,
      errors: [{ in: 'querystring', path: '/limit', message: 'must be <= 100' }],
    });
  });

  it.each(['limit=1e400', 'offset=1e400', 'offset=-Infinity', 'offset=9007199254740993'])(
    'rejects %s, which validation turns into an unsafe number',
    async (query) => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/facilities?${query}`,
        headers: AUTH_HEADER,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        detail: 'limit and offset must be integers in range',
      });
    },
  );

  it('rejects an empty query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities?q=',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects more than 20 amenities', async () => {
    const amenities = Array.from({ length: 21 }, (_, i) => `a${i}`).join(',');
    const response = await app.inject({
      method: 'GET',
      url: `/v1/facilities?amenities=${amenities}`,
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ detail: 'amenities accepts at most 20 entries' });
  });
});

describe('GET /v1/facilities/:id', () => {
  it('returns every detail of the facility', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities/facility-001',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'facility-001',
      name: 'City Fitness Central',
      address: '123 Market St, Sydney, NSW 2000',
      location: { latitude: -33.8703, longitude: 151.208 },
      amenities: ['Pool', 'Sauna', '24/7 Access', 'Yoga Classes'],
    });
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities/facility-999',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      status: 404,
      detail: 'Facility facility-999 not found',
    });
  });

  it('returns 400 Problem Details for an id longer than the router allows', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/facilities/${'a'.repeat(101)}`,
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({ detail: 'Path parameter too long' });
  });

  it('returns 400 for a malformed id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/facilities/bad%20id!',
      headers: AUTH_HEADER,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ in: 'params', path: '/id' }] });
  });
});

describe('facility routes', () => {
  it('are documented in the OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    const document = response.json<{
      paths: Record<string, { get: { parameters: { name: string; required: boolean }[] } }>;
    }>();
    expect(document.paths).toHaveProperty(['/v1/facilities/{id}']);
    // limit and offset have defaults, so no query parameter is required.
    const search = document.paths['/v1/facilities'].get;
    expect(search.parameters.filter((parameter) => parameter.required)).toEqual([]);
    expect(search).toMatchObject({
      responses: { '401': { content: { 'application/problem+json': {} } } },
    });
  });

  it('are rate limited before the token is checked', async () => {
    const limited = await buildTestApp({
      config: testConfig({ rateLimit: { max: 2, windowMs: 60_000 } }),
    });
    await limited.inject({ method: 'GET', url: '/v1/facilities' });
    await limited.inject({ method: 'GET', url: '/v1/facilities' });
    const response = await limited.inject({ method: 'GET', url: '/v1/facilities' });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });
    await limited.close();
  });

  it('rate limit by the client address a trusted proxy adds, ignoring spoofed entries', async () => {
    const limited = await buildTestApp({
      config: testConfig({ rateLimit: { max: 2, windowMs: 60_000 }, trustProxy: ['10.0.0.0/8'] }),
    });
    // The load balancer at 10.0.0.5 appends the real client address to whatever the client sent.
    const fromClient = (spoofed: string, real: string) =>
      limited.inject({
        method: 'GET',
        url: '/v1/facilities',
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-for': `${spoofed}, ${real}` },
      });
    const statuses = [
      (await fromClient('203.0.113.1', '198.51.100.7')).statusCode,
      (await fromClient('203.0.113.2', '198.51.100.7')).statusCode,
      (await fromClient('203.0.113.3', '198.51.100.7')).statusCode,
      (await fromClient('203.0.113.4', '198.51.100.8')).statusCode,
    ];
    expect(statuses).toEqual([401, 401, 429, 401]);
    await limited.close();
  });
});

describe('response schemas', () => {
  it('drop fields they do not declare', async () => {
    const stored = { ...facility('facility-001', 'City Fitness Central'), internalScore: 42 };
    const leaky = await buildTestApp({
      repository: {
        search: () => Promise.resolve({ items: [stored], total: 1 }),
        findById: () => Promise.resolve(stored),
        count: () => Promise.resolve(1),
      },
    });
    const search = await leaky.inject({
      method: 'GET',
      url: '/v1/facilities',
      headers: AUTH_HEADER,
    });
    const detail = await leaky.inject({
      method: 'GET',
      url: '/v1/facilities/facility-001',
      headers: AUTH_HEADER,
    });
    expect(Object.keys(search.json<{ data: object[] }>().data[0])).toEqual([
      'id',
      'name',
      'address',
    ]);
    expect(detail.json()).not.toHaveProperty('internalScore');
    await leaky.close();
  });
});
