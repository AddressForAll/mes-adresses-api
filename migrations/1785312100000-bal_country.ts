import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists which country a BAL belongs to, instead of leaving it to be
 * inferred from the shape of `commune`. The Overture importer already knows
 * the country at import time (`OvertureDivision.country`, ISO 3166-1
 * alpha-2) but previously discarded it — see `deriveTerritoryCode()` in
 * `apps/importer/src/commands/import-division.command.ts`.
 *
 * Defaulting to 'fr' backfills every pre-existing row correctly: every BAL
 * created before this migration is French.
 */
export class BalCountry1785312100000 implements MigrationInterface {
  name = 'BalCountry1785312100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bases_locales" ADD "country" character varying(2) NOT NULL DEFAULT 'fr'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bases_locales" DROP COLUMN "country"`,
    );
  }
}
