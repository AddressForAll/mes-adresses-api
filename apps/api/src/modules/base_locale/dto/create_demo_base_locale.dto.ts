import { ValidatorTerritoryCode } from '@/shared/validators/territory_code.validator';
import { ValidatorCountryCode } from '@/shared/validators/country_code.validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, Validate } from 'class-validator';

export class CreateDemoBaseLocaleDTO {
  @ApiProperty({ required: true, nullable: false })
  @Validate(ValidatorTerritoryCode, ['commune'])
  commune: string;

  @IsOptional()
  @ApiProperty({ required: false, nullable: true })
  populate?: boolean;

  @IsOptional()
  @ApiProperty({ required: false, nullable: true, default: 'fr' })
  @Validate(ValidatorCountryCode)
  country?: string;
}
