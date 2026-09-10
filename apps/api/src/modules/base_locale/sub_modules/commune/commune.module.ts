import { Module } from '@nestjs/common';
import { CommuneService } from './commune.service';
import { CommuneController } from './commune.controller';
import { TerritoryModule } from '@/shared/modules/territory/territory.module';

@Module({
  imports: [TerritoryModule],
  providers: [CommuneService],
  controllers: [CommuneController],
  exports: [CommuneService],
})
export class CommuneModule {}
