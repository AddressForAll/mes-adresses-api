import { Module } from '@nestjs/common';

import { TerritoryModule as TerritorySharedModule } from '@/shared/modules/territory/territory.module';

import { TerritoryController } from './territory.controller';

@Module({
  imports: [TerritorySharedModule],
  controllers: [TerritoryController],
})
export class TerritoryModule {}
