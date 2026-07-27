import { backendRequest } from '$lib/client/live/backend-transport';
import type { LegacyImportReport } from '$store/renderer/slices/legacy-import/legacy-import-types';

export type { LegacyImportReport } from '$store/renderer/slices/legacy-import/legacy-import-types';

export function importLegacyWorkspaces(force = false): Promise<LegacyImportReport> {
  return backendRequest<LegacyImportReport>('system.importLegacy', { force });
}