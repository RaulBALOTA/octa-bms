import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [MasterDataModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
