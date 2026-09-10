import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { TerritoryService } from '@/shared/modules/territory/territory.service';

import { TerritoryDTO } from './dto/territory.dto';

@ApiTags('territories')
@Controller('territories')
export class TerritoryController {
  constructor(private territoryService: TerritoryService) {}

  @Get(':country')
  @ApiOperation({
    summary: 'List the territories of a country, one level at a time',
    operationId: 'listTerritories',
  })
  @ApiParam({ name: 'country', required: true, type: String })
  @ApiQuery({
    name: 'parent',
    required: false,
    type: String,
    description:
      'Territory code whose children to list; omit for the top level',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TerritoryDTO, isArray: true })
  listTerritories(
    @Param('country') country: string,
    @Query('parent') parent?: string,
  ): TerritoryDTO[] {
    const territories = this.territoryService.listTerritories(
      country.toLowerCase(),
      parent,
    );
    if (!territories) {
      throw new HttpException(
        parent
          ? `Territory ${parent} not found`
          : `Country ${country} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return territories;
  }

  @Get(':country/:code')
  @ApiOperation({
    summary: 'Find one territory by code',
    operationId: 'findTerritory',
  })
  @ApiParam({ name: 'country', required: true, type: String })
  @ApiParam({ name: 'code', required: true, type: String })
  @ApiResponse({ status: HttpStatus.OK, type: TerritoryDTO })
  findTerritory(
    @Param('country') country: string,
    @Param('code') code: string,
  ): TerritoryDTO {
    const territory = this.territoryService.findTerritory(code);
    if (
      !territory ||
      !code.toLowerCase().startsWith(`${country.toLowerCase()}-`)
    ) {
      throw new HttpException(
        `Territory ${code} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return territory;
  }
}
