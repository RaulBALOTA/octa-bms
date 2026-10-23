import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { SearchModule } from '../search/search.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { RecordsFinanceService } from './records-finance.service';

@Module({ imports: [MasterDataModule, AuthModule, SearchModule], controllers: [RecordsController], providers: [RecordsService, RecordsFinanceService] })
export class RecordsModule {}
