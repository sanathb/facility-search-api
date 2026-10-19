import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      env: 'production',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      dataFile: 'assets/facilities.json',
      rateLimit: { max: 100, windowMs: 60_000 },
      corsOrigins: [],
      trustProxy: [],
    });
  });

  it('reads and converts provided values', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_MS: '1000',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com',
      TRUST_PROXY: '10.0.0.0/8, 172.16.0.1, fd00::/8',
      PATH: '/usr/bin',
    });
    expect(config).toMatchObject({
      env: 'development',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
      rateLimit: { max: 5, windowMs: 1000 },
      corsOrigins: ['https://a.example.com', 'https://b.example.com'],
      trustProxy: ['10.0.0.0/8', '172.16.0.1', 'fd00::/8'],
    });
  });

  it('treats blank values as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
    expect(loadConfig({ PORT: '  ' }).port).toBe(3000);
  });

  it('rejects invalid values with the variable name', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT must be <= 65535/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    // Fastify reads "1" as the address 0.0.0.1 and rejects the others without naming the variable.
    expect(() => loadConfig({ TRUST_PROXY: '1' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ TRUST_PROXY: '10.0.0.0/33' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ TRUST_PROXY: '0.0.0.0/0' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ TRUST_PROXY: '::/0' })).toThrow(/TRUST_PROXY/);
  });
});
