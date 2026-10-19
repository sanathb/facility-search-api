import { isIP } from 'node:net';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

const EnvSchema = Type.Object({
  // Production by default: JSON logs and no dev-only packages. `npm run dev` sets development.
  NODE_ENV: Type.Enum(['development', 'test', 'production'], { default: 'production' }),
  HOST: Type.String({ minLength: 1, default: '127.0.0.1' }),
  PORT: Type.Integer({ minimum: 0, maximum: 65535, default: 3000 }),
  LOG_LEVEL: Type.Enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
    default: 'info',
  }),
  DATA_FILE: Type.String({ minLength: 1, default: 'assets/facilities.json' }),
  RATE_LIMIT_MAX: Type.Integer({ minimum: 1, default: 100 }),
  RATE_LIMIT_WINDOW_MS: Type.Integer({ minimum: 1000, default: 60_000 }),
  CORS_ORIGINS: Type.String({ default: '' }),
  TRUST_PROXY: Type.String({ default: '' }),
});

const env = Compile(EnvSchema);

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  dataFile: string;
  rateLimit: { max: number; windowMs: number };
  corsOrigins: string[];
  /** Addresses or CIDR ranges of trusted proxies; empty means X-Forwarded-For is ignored. */
  trustProxy: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads settings from environment variables, applying defaults. Throws ConfigError if any are invalid. */
export function loadConfig(variables: Record<string, string | undefined> = process.env): Config {
  // Blank values count as unset, so `PORT=` falls back to the default instead of becoming 0.
  const provided = Object.fromEntries(
    Object.entries(variables).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  // Clean drops unrelated variables, Convert turns strings into numbers,
  // and Default fills in anything missing.
  const parsed = env.Default(env.Convert(env.Clean(provided)));
  if (!env.Check(parsed)) {
    const problems = env
      .Errors(parsed)
      .map((error) => `${error.instancePath.slice(1)} ${error.message}`);
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  const trustProxy = splitList(parsed.TRUST_PROXY);
  const badProxies = trustProxy.filter((entry) => !isAddressOrRange(entry));
  if (badProxies.length > 0) {
    throw new ConfigError(
      `Invalid configuration: TRUST_PROXY entries must be IP addresses or CIDR ranges, not ${badProxies.join(', ')}`,
    );
  }
  return {
    env: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    dataFile: parsed.DATA_FILE,
    rateLimit: { max: parsed.RATE_LIMIT_MAX, windowMs: parsed.RATE_LIMIT_WINDOW_MS },
    corsOrigins: splitList(parsed.CORS_ORIGINS),
    trustProxy,
  };
}

/** True for an IP address or a CIDR range such as 10.0.0.0/8. Rejects hop counts like "1". */
function isAddressOrRange(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  // Zone IDs (fe80::1%eth0) are refused by choice: a load balancer address never needs one.
  if (version === 0 || rest.length > 0 || address.includes('%')) return false;
  if (prefix === undefined) return true;
  // A /0 range would trust every address; proxy-addr rejects it too.
  const bits = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && bits >= 1 && bits <= (version === 4 ? 32 : 128);
}

/** Splits a comma-separated value, ignoring empty entries. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
