import { MigrationInterface, QueryRunner } from 'typeorm';

export class NumeroPostalCode1790121600000 implements MigrationInterface {
  name = 'NumeroPostalCode1790121600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "postal_code" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "postal_code"`);
  }
}
