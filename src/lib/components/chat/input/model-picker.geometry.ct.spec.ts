import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './ModelPickerPreview.svelte';

defineGeometrySnapshotSuite({
  scene: 'model-picker',
  component: Preview,
  states: ['adapter-error'],
  widths: [360],
  selector: '[data-slot="dropdown-content"], [data-dropdown-footer]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/model-picker.geometry.json', import.meta.url),
  ),
});
