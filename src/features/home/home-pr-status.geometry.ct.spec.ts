import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './home.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'home',
  component: Preview,
  states: ['pr-status-list', 'board-pr-status'],
  widths: [1440],
  selector: '[data-home-workspace]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/home-pr-status.geometry.json', import.meta.url),
  ),
});
