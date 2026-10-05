import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './task-dependencies.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'task-dependencies',
  component: Preview,
  states: ['adjacency'],
  widths: [720],
  selector: '[data-task-dependencies-preview], [data-task-item-row], [data-task-row-waits-on]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/task-dependencies.geometry.json', import.meta.url),
  ),
});
