import { MigrationInterface, QueryRunner } from 'typeorm';

export class NumberlessAddresses1789430400000 implements MigrationInterface {
  name = 'NumberlessAddresses1789430400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "numeros" ALTER COLUMN "numero" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "numeros" ADD "numero_texte" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "numero_texte"`);
    await queryRunner.query(
      `ALTER TABLE "numeros" ALTER COLUMN "numero" SET NOT NULL`,
    );
  }
}
