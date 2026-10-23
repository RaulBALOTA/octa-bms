import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BankingService } from './banking.service';

/**
 * Background statement sync. PSD2 lets an aggregator read without the user
 * present at most 4× per day per account, so 6 hours stays inside the limit.
 */
@Injectable()
export class BankSyncScheduler {
  constructor(private readonly banking: BankingService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  run() {
    return this.banking.syncAll();
  }
}
