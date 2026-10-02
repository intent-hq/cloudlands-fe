import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './chat-mermaid-streaming.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'chat-mermaid-streaming',
  component: Preview,
  // Svelte named exports are browser import references in CT, not serializable Node data.
  captureReadiness: { selector: '.mermaid-renderer[data-render-settled="true"]', count: 1 },
  states: ['complete'],
  widths: [420],
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/chat-mermaid-streaming.geometry.json', import.meta.url),
  ),
});
