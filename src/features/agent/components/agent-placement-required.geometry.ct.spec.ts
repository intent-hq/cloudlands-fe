import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './agent-placement-required.preview.svelte';
defineGeometrySnapshotSuite({
  scene: 'agent-placement-required',
  component: Preview,
  states: ['local', 'without-isolation'],
  widths: [520],
  selector: '[data-required-placement-preview]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/agent-placement-required.geometry.json', import.meta.url),
  ),
});
