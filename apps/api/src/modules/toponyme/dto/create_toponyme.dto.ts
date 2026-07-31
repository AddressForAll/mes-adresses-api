import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Validate,
  IsOptional,
  ValidateNested,
  IsNotEmptyObject,
  IsNotEmpty,
} from 'class-validator';

import { ValidatorBal } from '@/shared/validators/validator_bal.validator';
import { Position } from '@/shared/entities/position.entity';
import { ValidatorTerritoryCode } from '@/shared/validators/territory_code.validator';

export class CreateToponymeDTO {
  @IsNotEmpty({ message: 'voie_nom:Le champ nom est obligatoire' })
  @Validate(ValidatorBal, ['voie_nom'])
  @ApiProperty({ required: true, nullable: false })
  nom: string;

  @IsOptional()
  @IsNotEmptyObject()
  @Validate(ValidatorBal, ['lang_alt'])
  @ApiProperty({ required: false, nullable: true })
  nomAlt: Record<string, string>;

  @Validate(ValidatorTerritoryCode, ['commune_deleguee'])
  @ApiProperty({ required: false, nullable: true })
  communeDeleguee?: string;

  @IsOptional()
  @Validate(ValidatorBal, ['cad_parcelles'])
  @ApiProperty({ required: false, nullable: true })
  parcelles?: string[];

  @IsOptional()
  @ValidateNested({
    each: true,
    message: 'positions:Doit être un tableau de position',
  })
  @Type(() => Position)
  @ApiProperty({
    type: () => Position,
    isArray: true,
    required: false,
    nullable: false,
  })
  positions?: Position[];
}
