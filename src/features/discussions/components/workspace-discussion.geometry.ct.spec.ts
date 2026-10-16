import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './workspace-discussion.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'workspace-discussion',
  component: Preview,
  states: ['workspace', 'narrow', 'typing', 'typing-narrow'],
  widths: [1100],
  selector:
    '[data-discussion-preview], [data-discussion-scroll], [data-discussion-message], [data-discussion-composer]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/workspace-discussion.geometry.json', import.meta.url),
  ),
});
