import { MigrationInterface, QueryRunner } from 'typeorm';

export class NumeroGeocodeInscricao1794787200000 implements MigrationInterface {
  name = 'NumeroGeocodeInscricao1794787200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "geocode" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "inscricao_imobiliaria" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "numeros" DROP COLUMN "inscricao_imobiliaria"`,
    );
    await queryRunner.query(`ALTER TABLE "numeros" DROP COLUMN "geocode"`);
  }
}
