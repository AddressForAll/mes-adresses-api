import { NestFactory } from '@nestjs/core';

import { WinstonLogger } from '@/shared/modules/logger/logger.service';
import { Logger } from '@/shared/utils/logger.utils';

import { ImporterModule } from './importer.module';
import { USAGE, parseCli } from './cli/args';
import { FindDivisionsCommand } from './commands/find-divisions.command';
import { ImportDivisionCommand } from './commands/import-division.command';

/**
 * CLI entrypoint for the Overture importer.
 *
 * A Nest *application context* — no HTTP server — so it can reuse the app's
 * services (notably BaseLocaleService.populate) while running as a throwaway
 * container:
 *
 *   docker compose -f docker-compose.local.yml run --rm importer \
 *     yarn overture:import --division <gers-id> --bal <bal-id>
 */
async function bootstrap(): Promise<void> {
  let command: string | undefined;
  let values: Record<string, unknown>;

  try {
    ({ command, values } = parseCli());
  } catch (err) {
    console.error(`${(err as Error).message}\n${USAGE}`);
    process.exit(2);
  }

  if (!command || values.help) {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }

  if (command !== 'find' && command !== 'import') {
    console.error(`Unknown command "${command}".\n${USAGE}`);
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(ImporterModule, {
    logger: new WinstonLogger(Logger),
    // Surface bootstrap failures instead of letting Nest swallow them.
    abortOnError: false,
  });

  let code = 0;
  try {
    code =
      command === 'find'
        ? await app.get(FindDivisionsCommand).run(values)
        : await app.get(ImportDivisionCommand).run(values);
  } catch (err) {
    console.error((err as Error)?.stack ?? err);
    code = 1;
  } finally {
    await app.close();
  }

  // Required: the BullMQ Redis connection and the TypeORM pool keep the event
  // loop alive, so without this the container hangs after a successful run.
  // apps/cron never hits this because it is meant to run forever.
  process.exit(code);
}

bootstrap();
