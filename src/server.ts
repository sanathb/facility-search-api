import type { FastifyInstance } from 'fastify';
import { login } from '../assets/auth.js';
import { buildApp } from './app.js';
import { MockTokenVerifier } from './auth/token-verifier.js';
import { loadConfig } from './config.js';
import { loadFacilities } from './data/load-facilities.js';
import { InMemoryFacilityRepository } from './repositories/facility-repository.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const facilities = await loadFacilities(config.dataFile);

  const indexStart = performance.now();
  const repository = new InMemoryFacilityRepository(facilities);
  const indexBuildMs = Math.round(performance.now() - indexStart);

  const app = await buildApp({ config, repository, tokenVerifier: new MockTokenVerifier(), login });
  app.log.info({ facilityCount: facilities.length, indexBuildMs }, 'Facility index built');

  handleShutdown(app);
  await app.listen({ host: config.host, port: config.port });
}

/** Stops cleanly on SIGTERM/SIGINT; exits on errors nothing else caught. */
function handleShutdown(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');

    // If in-flight requests don't finish in time, exit anyway rather than hang.
    setTimeout(() => {
      app.log.error('Shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // The process is in an unknown state: log it and let the supervisor restart it.
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  // Startup failed: bad configuration, a bad data file or the port is in use.
  console.error(error);
  process.exit(1);
});
