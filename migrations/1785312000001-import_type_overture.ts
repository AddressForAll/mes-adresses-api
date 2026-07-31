import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'overture' to the import_type enum.
 *
 * Kept in its own migration on purpose: `ALTER TYPE ... ADD VALUE` has
 * transaction restrictions in PostgreSQL. Adding the label without *using* it
 * in the same transaction is legal on PG 12+ (prod is PG 16, the local stack is
 * postgis:16-3.4), but bundling it with DDL that then uses the new value is not
 * — so it stays isolated.
 */
export class ImportTypeOverture1785312000001 implements MigrationInterface {
  name = 'ImportTypeOverture1785312000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."bases_locales_import_type_enum" ADD VALUE IF NOT EXISTS 'overture'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot DROP an enum label. Reverting would mean recreating the
    // type, which requires rewriting every row that uses 'overture' first:
    //
    //   ALTER TABLE bases_locales ALTER COLUMN import_type TYPE text;
    //   UPDATE bases_locales SET import_type = NULL WHERE import_type = 'overture';
    //   DROP TYPE bases_locales_import_type_enum;
    //   CREATE TYPE bases_locales_import_type_enum AS ENUM('api-depot','ban','csv');
    //   ALTER TABLE bases_locales ALTER COLUMN import_type
    //     TYPE bases_locales_import_type_enum
    //     USING import_type::bases_locales_import_type_enum;
    //
    // Deliberately a no-op rather than a destructive automatic rollback.
  }
}
