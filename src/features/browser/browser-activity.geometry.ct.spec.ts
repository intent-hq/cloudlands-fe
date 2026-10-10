import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './browser-activity.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'browser-activity',
  component: Preview,
  states: ['opened'],
  widths: [420],
  selector: '[data-testid="browser-activity-preview"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/browser-activity.geometry.json', import.meta.url),
  ),
});
