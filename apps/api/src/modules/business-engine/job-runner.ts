import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * In-process runner for expensive engine runs (Monte Carlo, sensitivity, optimization).
 * The repository has no queue infrastructure; runs are persisted with status, executed outside the
 * request, bounded in concurrency, cancellable, and marked FAILED if the API restarts mid-run.
 */
@Injectable()
export class EngineJobRunner implements OnModuleInit {
  private readonly logger = new Logger(EngineJobRunner.name);
  private readonly cancelled = new Set<string>();
  private readonly active = new Set<string>();
  private readonly waiting: (() => void)[] = [];
  static readonly MAX_CONCURRENT = 2;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const note = 'Interrupted by an API restart';
    try {
      await this.prisma.engineScenarioRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', error: note, finishedAt: new Date() } });
      await this.prisma.engineOptimizationRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', error: note, finishedAt: new Date() } });
    } catch (error) {
      this.logger.warn(`Could not reset interrupted engine runs (is the business engine schema installed?): ${String(error)}`);
    }
  }

  isRunning(id: string) { return this.active.has(id); }
  cancel(id: string) { if (!this.active.has(id)) return false; this.cancelled.add(id); return true; }

  /** Starts a job in the background; `onError` persists failures. Never throws into the request. */
  start(id: string, job: (shouldStop: () => boolean) => Promise<void>, onError: (error: unknown) => Promise<void>) {
    this.active.add(id);
    const run = async () => {
      try { await job(() => this.cancelled.has(id)); }
      catch (error) { this.logger.error(`Engine job ${id} failed: ${String(error)}`); await onError(error).catch(() => undefined); }
      finally {
        this.active.delete(id); this.cancelled.delete(id); this.running--;
        this.waiting.shift()?.();
      }
    };
    const begin = () => { this.running++; setImmediate(() => void run()); };
    if (this.running < EngineJobRunner.MAX_CONCURRENT) begin(); else this.waiting.push(begin);
  }
  private running = 0;
}
