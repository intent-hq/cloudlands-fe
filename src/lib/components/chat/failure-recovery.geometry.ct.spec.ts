import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './failure-recovery.preview.svelte';
defineGeometrySnapshotSuite({
  scene: 'failure-recovery',
  component: Preview,
  states: ['repeated-failures', 'partial-output', 'long-error'],
  widths: [420],
  selector:
    '[data-testid="failure-recovery-preview"], [data-testid="failure-recovery-card"], [data-testid="failure-raw-details"], .turn-failure-notice, [data-testid="queued-message-retry-status"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/failure-recovery.geometry.json', import.meta.url),
  ),
});
