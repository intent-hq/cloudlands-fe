import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './agent-background-mode.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'agent-background-mode',
  component: Preview,
  states: ['foreground'],
  widths: [420],
  selector: '[data-testid="agent-mode-preview"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/agent-background-mode.geometry.json', import.meta.url),
  ),
});
