import { apiDownload } from './api';

export type ExportScope = 'board' | 'completed' | 'theatre';
export interface ExportFilters { q: string; priority: string; status: string; action: string; from: string; to: string }

// Same filters as the board; 'all' and blank values are left out.
export function exportQuery(scope: ExportScope, filters: ExportFilters) {
  const params = new URLSearchParams({ scope });
  for (const [key, value] of Object.entries(filters)) if (value.trim() && value !== 'all') params.set(key, value.trim());
  return params.toString();
}

export async function downloadExport(scope: ExportScope, filters: ExportFilters, signal?: AbortSignal) {
  const { blob, filename, rows } = await apiDownload(`/export/?${exportQuery(scope, filters)}`, signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, rows };
}
