import { Module } from '@nestjs/common';

import { TerritoryService } from './territory.service';

@Module({
  providers: [TerritoryService],
  exports: [TerritoryService],
})
export class TerritoryModule {}
