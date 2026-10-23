import { BadRequestException } from '@nestjs/common';
import type { AuthUser } from '../../core/auth/decorators';
import { EngineInputError } from './domain/calendar';

export const can = (user: AuthUser, code: string) => user.isSystemAdmin || (user.permissions ?? []).includes(code);
/** Cost rates, purchase rates, payroll-type costs and margins are confidential (engine.economics.read). */
export const canSeeCosts = (user: AuthUser) => can(user, 'engine.economics.read');

/** Translate deterministic engine input errors into 400 responses with a stable code. */
export function engineCall<T>(fn: () => T): T {
  try { return fn(); } catch (error) {
    if (error instanceof EngineInputError) throw new BadRequestException({ code: error.code, message: error.message });
    throw error;
  }
}
export async function engineCallAsync<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof EngineInputError) throw new BadRequestException({ code: error.code, message: error.message });
    throw error;
  }
}
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const today = () => new Date().toISOString().slice(0, 10);
