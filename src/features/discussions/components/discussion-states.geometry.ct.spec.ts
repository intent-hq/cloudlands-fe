import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './discussion-states.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'discussion-states',
  component: Preview,
  states: [
    'new',
    'direct',
    'unread',
    'sending',
    'failed',
    'references',
    'reactions',
    'loading',
    'sharing-off',
  ],
  widths: [470, 370],
  selector:
    '[data-discussion-states-preview], [data-discussion-header], [data-discussion-scroll], [data-discussion-message], [data-discussion-composer], [data-discussion-sharing-off], [data-discussion-unread]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/discussion-states.geometry.json', import.meta.url),
  ),
});
