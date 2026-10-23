import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { PortfolioMode, PortfolioResult } from '../../../../../packages/shared/src/business-engine';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui';

export type { PortfolioMode };
export interface EngineFilters { mode: PortfolioMode; clientId: string; serviceId: string; scenarioId: string; departmentId: string }
export const useEngineFilters = create<EngineFilters & { set: (patch: Partial<EngineFilters>) => void }>((set) => ({
  mode: 'EXPECTED', clientId: '', serviceId: '', scenarioId: '', departmentId: '', set: (patch) => set(patch),
}));
export function filterQuery(f: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (typeof v === 'string' && v) p.set(k, v);
  return p.toString();
}

export interface KpiDefinition { definition: string; source: string; included: string; excluded: string; basis: string }
export interface SnapshotMetaDto { excluded: { id: string; title: string; reason: string }[]; fxWarnings: string[]; scenario?: { id: string; name: string } }
export interface OverviewDto {
  result: PortfolioResult; contracted: { totals: PortfolioResult['totals']; cash: { minBalance: string; minBalanceDate: string; peakDeficit: string } } | null;
  topServices: PortfolioResult['byService']; underperformingServices: PortfolioResult['byService']; alerts: Record<string, number>;
  recommendations: { id: string; title: string; priority: string; source: string; confidence: string; responsibleRole: string | null }[];
  definitions: Record<string, KpiDefinition>; meta: SnapshotMetaDto;
}

const key = (...parts: unknown[]) => ['engine', ...parts];
export const engineGet = <T,>(path: string) => api.get<T>(`/engine${path}`);

export function useEngineQuery<T>(parts: unknown[], path: string | null, options: { refetchInterval?: number | false | ((data: T | undefined) => number | false); enabled?: boolean } = {}) {
  const interval = options.refetchInterval;
  return useQuery({ queryKey: key(...parts), queryFn: () => engineGet<T>(path as string), enabled: !!path && (options.enabled ?? true),
    refetchInterval: typeof interval === 'function' ? (query) => interval(query.state.data as T | undefined) : interval });
}
/** Poll while a background run is RUNNING; stop once it has finished. */
export const pollWhileRunning = (data: { status?: string } | undefined) => (!data || data.status === 'RUNNING' ? 1500 : false);

/** Mutation helper: toasts errors, invalidates every engine query on success. */
export function useEngineMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, options: { success?: string; onSuccess?: (r: TResult) => void } = {}) {
  const client = useQueryClient(); const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => { await client.invalidateQueries({ queryKey: ['engine'] }); if (options.success) toast(options.success); options.onSuccess?.(result); },
    onError: (error: Error) => toast(error.message, 'error'),
  });
}
export const enginePost = <T,>(path: string, body?: unknown) => api.post<T>(`/engine${path}`, body);
export const enginePut = <T,>(path: string, body?: unknown) => api.put<T>(`/engine${path}`, body);
export const engineDelete = (path: string) => api.delete(`/engine${path}`);
