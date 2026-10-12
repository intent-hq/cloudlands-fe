import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './workspace-tabs-micro.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'workspace-tabs-micro',
  component: Preview,
  states: ['list', 'disconnected'],
  widths: [720],
  selector: '[data-workspace-tab]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/workspace-tabs-micro.geometry.json', import.meta.url),
  ),
});
