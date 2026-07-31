import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MailerModule } from '@nestjs-modules/mailer';

import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { Position } from '@/shared/entities/position.entity';
import { Cache } from '@/shared/entities/cache.entity';
import { MailerParams } from '@/shared/params/mailer.params';

import { BaseLocaleModule } from '@/modules/base_locale/base_locale.module';
import { OvertureModule } from '@/shared/modules/overture/overture.module';

import { FindDivisionsCommand } from './commands/find-divisions.command';
import { ImportDivisionCommand } from './commands/import-division.command';

/**
 * Root module of the `importer` app — a CLI-only Nest application context with
 * no HTTP server (see main.ts). It deliberately mirrors `CronModule`'s
 * infrastructure wiring, then adds `BaseLocaleModule` so the importer can reuse
 * `BaseLocaleService.populate()` — the same code path the CSV and BAN imports
 * use — instead of duplicating entity-construction logic.
 *
 * Note: no `ServeStaticModule` here; it requires an HTTP adapter and would
 * throw in an application context.
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL'),
        },
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true,
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('POSTGRES_URL'),
        keepConnectionAlive: true,
        schema: 'public',
        entities: [BaseLocale, Voie, Numero, Toponyme, Position, Cache],
      }),
      inject: [ConfigService],
    }),
    MailerModule.forRootAsync(MailerParams),
    // The commands read/write these directly for the pre-flight guards.
    TypeOrmModule.forFeature([BaseLocale, Voie, Numero]),
    BaseLocaleModule,
    OvertureModule,
  ],
  providers: [Logger, FindDivisionsCommand, ImportDivisionCommand],
})
export class ImporterModule {}
