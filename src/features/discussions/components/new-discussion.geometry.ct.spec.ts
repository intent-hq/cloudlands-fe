import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './new-discussion.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'new-discussion',
  component: Preview,
  states: ['empty', 'selected', 'narrow'],
  widths: [720],
  selector:
    '[data-new-discussion-preview], [data-discussion-recipients], [data-discussion-composer]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/new-discussion.geometry.json', import.meta.url),
  ),
});
