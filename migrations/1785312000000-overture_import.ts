import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Groundwork for country-agnostic imports sourced from Overture Maps.
 *
 * Three independent changes:
 *
 * 1. `bases_locales.commune` becomes an OPAQUE territory code rather than a
 *    French INSEE/COG code. 16 chars comfortably fits a 5-digit INSEE code, a
 *    7-digit US place FIPS, a 7-digit Brazilian IBGE code, or a synthetic
 *    "<CC>-<8 hex>" code derived from an Overture division GERS id.
 *    Which codes are *accepted* is decided by ValidatorTerritoryCode, driven by
 *    the COUNTRY_PROFILE env var — this migration only widens the storage.
 *
 * 2. `bases_locales.source_division_id` records which Overture division (GERS
 *    id) a BAL was imported from, so a re-import can be verified against the
 *    same territory instead of silently replacing a different one.
 *
 * 3. `gers_id` on voies/numeros carries Overture's stable feature identifier
 *    through the import. GERS ids persist across Overture releases, which is
 *    what makes a later re-sync (or contributing corrections back upstream)
 *    possible. Backfilling these after the fact is not possible, so they are
 *    captured from the first import onwards.
 */
export class OvertureImport1785312000000 implements MigrationInterface {
  name = 'OvertureImport1785312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widening a varchar needs no USING clause and no table rewrite.
    await queryRunner.query(
      `ALTER TABLE "bases_locales" ALTER COLUMN "commune" TYPE character varying(16)`,
    );

    await queryRunner.query(
      `ALTER TABLE "bases_locales" ADD "source_division_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bases_locales_source_division_id" ON "bases_locales" ("source_division_id") WHERE "source_division_id" IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE "voies" ADD "gers_id" uuid`);
    await queryRunner.query(`ALTER TABLE "numeros" ADD "gers_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_voies_gers_id" ON "voies" ("gers_id") WHERE "gers_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_numeros_gers_id" ON "numeros" ("gers_id") WHERE "gers_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_numeros_gers_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_voies_gers_id"`);
    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "gers_id"`);
    await queryRunner.query(`ALTER TABLE "voies" DROP COLUMN "gers_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bases_locales_source_division_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bases_locales" DROP COLUMN "source_division_id"`,
    );
    // NOTE: this narrowing FAILS if any row holds a commune longer than 5
    // chars. That is deliberate — silently truncating a territory code would
    // corrupt data. Delete or migrate the offending BALs before rolling back.
    await queryRunner.query(
      `ALTER TABLE "bases_locales" ALTER COLUMN "commune" TYPE character varying(5)`,
    );
  }
}
