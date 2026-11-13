import type { DockMediaNativeOutput } from '$shared/dock-media-output';
import type { DockSavedMedia } from '$shared/dock-media-edit';
import { DOCK_MEDIA_OUTPUT_VERSION } from '$shared/dock-media-edit';
import { dockMediaOverlaySpans } from '$shared/dock-media-animation';
import type { DockEvidenceNativeService } from '$shared/dock-evidence';
import type { DockSendStage } from './dock-send-diagnostics';
import { renderDockMediaOverlay } from './dock-media-render';

export interface PreparedRecordingExport {
  jobId: string;
  value: DockMediaNativeOutput;
}
/** Unplaced output only: the caller owns placement, metadata, admission and final release. */
export async function exportRecording(
  media: DockSavedMedia & { saved: NonNullable<DockSavedMedia['saved']> },
  jobId: string,
  service: Pick<DockEvidenceNativeService, 'exportMedia'>,
  current: () => boolean,
  stage: (value: DockSendStage) => void = () => {},
): Promise<PreparedRecordingExport> {
  const check = () => {
    if (!current()) throw new Error('media-send-retired');
  };
  check();
  stage('overlay-render');
  if (!service.exportMedia) throw new Error('media-export-unavailable');
  const spans = dockMediaOverlaySpans(media.source, media.saved);
  if (spans.length > 10000) throw new Error('media-animation-layer-limit');
  const layers = [];
  for (const span of spans) {
    check();
    layers.push({
      ...span,
      png: await renderDockMediaOverlay(media.source, media.saved, span.atMs),
    });
  }
  check();
  stage('export');
  const exported = await service.exportMedia({
    outputVersion: DOCK_MEDIA_OUTPUT_VERSION,
    jobId,
    media,
    layers,
  });
  check();
  if (!exported.ok)
    throw new Error(['media-export-failed', exported.error].filter(Boolean).join(':'));
  return { jobId, value: exported.value };
}
