import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ButtonPreview, { preview } from './button.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'button',
  component: ButtonPreview,
  definition: preview,
  states: ['default', 'loading', 'disabled', 'destructive'],
  widths: [420],
  snapshotPath: fileURLToPath(new URL('./__geometry__/button.geometry.json', import.meta.url)),
});
