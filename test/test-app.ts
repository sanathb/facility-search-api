import { buildApp, type AppDependencies } from '../src/app.js';
import type { Config } from '../src/config.js';
import { loadFacilities } from '../src/data/load-facilities.js';
import { InMemoryFacilityRepository } from '../src/repositories/facility-repository.js';

export type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    dataFile: 'assets/facilities.json',
    rateLimit: { max: 1000, windowMs: 60_000 },
    corsOrigins: [],
    trustProxy: [],
    ...overrides,
  };
}

/** The app with the real data file; override any dependency. */
export async function buildTestApp(overrides: Partial<AppDependencies> = {}) {
  const facilities = await loadFacilities('assets/facilities.json');
  return buildApp({
    config: testConfig(),
    repository: new InMemoryFacilityRepository(facilities),
    ...overrides,
  });
}
