import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the territory display name on `bases_locales`.
 *
 * `communeNom` used to be computed only, from the French COG, so every BAL
 * whose territory code is not a French commune (e.g. `US-197cfe35`) had no
 * name at all and the editor rendered an empty breadcrumb. The COG still
 * wins for French codes (see `BaseLocale.getCommuneNom`); this column is the
 * fallback, filled by the Overture importer from the division name.
 *
 * Backfill: BALs the importer already created were named
 * "Adresses de <division name>" (plus " [démo]" for a demo), so that is the
 * only record of the name. Rows a user has since renamed away from the
 * pattern are left NULL rather than guessed; re-running the import sets it.
 */
export class CommuneNom1789061765000 implements MigrationInterface {
  name = 'CommuneNom1789061765000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bases_locales" ADD "commune_nom" text`,
    );

    await queryRunner.query(
      `UPDATE "bases_locales"
          SET "commune_nom" = regexp_replace("nom", '^Adresses de (.+?)( \\[démo\\])?$', '\\1')
        WHERE "import_type" = 'overture'
          AND "commune_nom" IS NULL
          AND "nom" ~ '^Adresses de .+'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bases_locales" DROP COLUMN "commune_nom"`,
    );
  }
}
