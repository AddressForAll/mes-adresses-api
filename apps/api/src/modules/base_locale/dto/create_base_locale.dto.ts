import { ValidatorTerritoryCode } from '@/shared/validators/territory_code.validator';
import { ValidatorCountryCode } from '@/shared/validators/country_code.validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  Validate,
} from 'class-validator';

export class CreateBaseLocaleDTO {
  @IsNotEmpty()
  @ApiProperty({ required: true, nullable: false })
  nom: string;

  @ApiProperty({ required: true, nullable: false })
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  emails: Array<string>;

  @ApiProperty({ required: true, nullable: false })
  @Validate(ValidatorTerritoryCode, ['commune'])
  commune: string;

  @IsOptional()
  @ApiProperty({ required: false, nullable: true, default: 'fr' })
  @Validate(ValidatorCountryCode)
  country?: string;
}
