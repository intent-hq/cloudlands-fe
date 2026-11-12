import { m } from '$shared/paraglide/messages.js';
import type { TransferProgress } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';

/** Human copy for a relay phase or source build stage. */
export function transferStageLabel(
  progress: TransferProgress | null,
  options: { download?: boolean } = {},
): string {
  if (!progress) return m.workspace_transfer_stage_building();
  if (progress.phase === 'committing') return m.workspace_transfer_phase_committing();
  if (progress.phase === 'relaying') {
    return options.download
      ? m.workspace_transfer_phase_downloading()
      : m.workspace_transfer_phase_relaying();
  }
  switch (progress.stage) {
    case 'stopping-agents':
      return m.workspace_transfer_stage_stoppingAgents();
    case 'exporting-rows':
      return m.workspace_transfer_stage_exportingRows();
    case 'bundling-git':
      return m.workspace_transfer_stage_bundlingGit();
    case 'writing-archive':
      return m.workspace_transfer_stage_writingArchive();
    default:
      return m.workspace_transfer_stage_building();
  }
}
