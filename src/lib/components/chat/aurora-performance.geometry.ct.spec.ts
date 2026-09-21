import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './aurora-performance.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'aurora-performance',
  component: Preview,
  states: ['native-30'],
  widths: [1024],
  selector: '[data-testid="aura-benchmark-stage"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/aurora-performance.geometry.json', import.meta.url),
  ),
});
