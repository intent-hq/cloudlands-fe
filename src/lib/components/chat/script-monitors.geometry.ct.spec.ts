import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './script-monitors.preview.svelte';
defineGeometrySnapshotSuite({
  scene: 'script-monitors',
  component: Preview,
  states: ['conditions', 'cancel-error'],
  widths: [420],
  selector: '[data-testid="script-monitors-preview"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/script-monitors.geometry.json', import.meta.url),
  ),
});
