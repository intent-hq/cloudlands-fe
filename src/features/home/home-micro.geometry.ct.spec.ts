import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './home-micro.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'home-micro',
  component: Preview,
  states: ['list', 'board', 'disconnected'],
  widths: [1440],
  selector: '[data-home-workspace]',
  snapshotPath: fileURLToPath(new URL('./__geometry__/home-micro.geometry.json', import.meta.url)),
});
