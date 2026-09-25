import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './encoder-effort.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'encoder-effort',
  component: Preview,
  states: ['high'],
  widths: [480],
  selector:
    '[data-testid="encoder-effort-preview"], [role="status"], [data-testid="effort-picker-trigger"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/encoder-effort.geometry.json', import.meta.url),
  ),
});
