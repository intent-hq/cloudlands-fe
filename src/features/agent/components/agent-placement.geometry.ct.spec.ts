import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './agent-placement.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'agent-placement',
  component: Preview,
  states: ['local', 'remote-disabled', 'unavailable'],
  widths: [420],
  selector: '[data-agent-placement-preview]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/agent-placement.geometry.json', import.meta.url),
  ),
});
