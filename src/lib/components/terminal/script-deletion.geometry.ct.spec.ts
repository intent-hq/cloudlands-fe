import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './script-deletion.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'script-deletion',
  component: Preview,
  states: ['stopped'],
  widths: [900],
  selector: '[data-testid="script-deletion-preview"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/script-deletion.geometry.json', import.meta.url),
  ),
});
