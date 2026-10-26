import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type { CaseDetail, ListRow } from './types';

export function useApplications(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['applications', params], queryFn: () => api.get<{ rows: ListRow[] }>(`/applications${qs(params)}`) });
}

export function useCase(id: string | undefined) {
  return useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/applications/${id}`), enabled: !!id });
}

export function useCaseAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: string; reason?: string; payload?: unknown } | FormData) => api.post<CaseDetail>(`/applications/${id}/actions`, body as Record<string, unknown> | FormData),
    onSuccess: (data) => {
      if (data && 'application' in data) {
        qc.setQueryData(['case', id], data);
        qc.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'case' && q.queryKey[1] === id) });
      } else {
        // The action moved the case out of the user's scope: drop the cached case instead of refetching it.
        qc.removeQueries({ queryKey: ['case', id] });
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'case' });
      }
    },
  });
}

export function useMyLoad() {
  return useQuery({ queryKey: ['my-load'], queryFn: () => api.get<{ openPoints: number; openTasks: number; capacity: number }>('/assignments/my-load') });
}
