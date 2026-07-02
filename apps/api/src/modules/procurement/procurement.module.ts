import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { ProcurementController } from './procurement.controller';

@Module({
  imports: [MasterDataModule],
  controllers: [ProcurementController],
})
export class ProcurementModule {}
