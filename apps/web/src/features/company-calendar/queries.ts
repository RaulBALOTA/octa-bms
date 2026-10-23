import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Paged } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import type { CalendarItem, Capability, History, Horizon, Member } from './types';

export function useCalendarCapability() {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'capabilities'], queryFn: () => api.get<Capability>('/business-calendar/capabilities'), enabled: !!companyId && !!me });
}
export function useCalendarItems(params: URLSearchParams, enabled: boolean) {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'items', params.toString()], queryFn: () => api.get<Paged<CalendarItem>>(`/business-calendar/items?${params}`), enabled: enabled && !!companyId });
}
export function useCalendarHorizon(params: URLSearchParams, enabled: boolean) {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'horizon', params.toString()], queryFn: () => api.get<Horizon>(`/business-calendar/horizon?${params}`), enabled: enabled && !!companyId });
}
export function useCalendarDetail(id: string | null, enabled: boolean) {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'item', id], queryFn: () => api.get<CalendarItem>(`/business-calendar/items/${id}`), enabled: enabled && !!id });
}
export function useCalendarHistory(id: string, enabled: boolean) {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'history', id], queryFn: () => api.get<History[]>(`/business-calendar/items/${id}/history`), enabled });
}
export function useCalendarMembers(enabled: boolean) {
  const { companyId, me } = useAuthStore();
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'members'], queryFn: () => api.get<Member[]>('/business-calendar/members'), enabled });
}
export function useCalendarMutation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ path, body, method = 'post' }: { path: string; body: unknown; method?: 'post' | 'patch' }) => api[method]<{ id: string }>(`/business-calendar/${path}`, body), onSuccess: () => client.invalidateQueries({ queryKey: ['company-calendar'] }) });
}
export function useCalendarEntities(type: string, search: string, selectedId: string) {
  const { companyId, me } = useAuthStore();
  const params = new URLSearchParams({ type, search, selectedId });
  return useQuery({ queryKey: ['company-calendar', companyId, me?.id, 'entities', type, search, selectedId], queryFn: () => api.get<{ id: string; label: string }[]>(`/business-calendar/entities?${params}`), enabled: !!type });
}
