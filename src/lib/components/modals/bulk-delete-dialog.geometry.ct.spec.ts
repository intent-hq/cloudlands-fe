import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './bulk-delete-dialog.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'bulk-delete-dialog',
  component: Preview,
  states: ['archived'],
  widths: [548],
  selector: '[role="dialog"], [data-slot="dialog-body"], [role="list"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/bulk-delete-dialog.geometry.json', import.meta.url),
  ),
});
