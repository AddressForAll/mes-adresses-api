import { ApiProperty } from '@nestjs/swagger';

import { Territory } from '@/shared/modules/territory/territory.service';

export class TerritoryDTO implements Territory {
  @ApiProperty({ description: 'Territory code, as stored in the BAL commune' })
  code: string;

  @ApiProperty()
  nom: string;

  @ApiProperty({ description: 'Level key, e.g. state, county, place' })
  level: string;

  @ApiProperty({ description: 'Overture division_area GERS id' })
  divisionId: string;

  @ApiProperty({ type: Number, isArray: true })
  bbox: number[];

  @ApiProperty({ type: String, isArray: true })
  path: string[];

  @ApiProperty()
  hasChildren: boolean;

  @ApiProperty()
  selectable: boolean;
}
