import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './home.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'home',
  component: Preview,
  states: ['dashboard', 'dashboard-repository'],
  widths: [1440],
  viewportHeight: 770,
  selector: '[data-home-dashboard], [data-home-workspace], [data-home-group]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/home-dashboard.geometry.json', import.meta.url),
  ),
});
