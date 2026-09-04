import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';

defineGeometrySnapshotSuite({
  preview: () => import('./button.preview'),
  states: ['default', 'loading', 'disabled', 'destructive'],
  widths: [420],
  snapshotPath: fileURLToPath(new URL('./__geometry__/button.geometry.json', import.meta.url)),
});
