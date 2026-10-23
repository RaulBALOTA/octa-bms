import { Module } from '@nestjs/common';
import { BankSyncScheduler } from './bank-sync.scheduler';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';

// Always registered; BANKING_ENABLED gates every endpoint server-side.
@Module({ controllers: [BankingController], providers: [BankingService, BankSyncScheduler] })
export class BankingModule {}
