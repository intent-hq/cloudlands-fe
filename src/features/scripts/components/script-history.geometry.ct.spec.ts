import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './script-history.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'script-history',
  component: Preview,
  states: ['large'],
  widths: [720],
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/script-history.geometry.json', import.meta.url),
  ),
});
