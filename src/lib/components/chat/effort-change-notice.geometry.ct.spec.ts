import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './effort-change-notice.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'effort-change-notice',
  component: Preview,
  states: ['transcript'],
  widths: [420],
  selector: '[data-testid="effort-transcript"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/effort-change-notice.geometry.json', import.meta.url),
  ),
});
