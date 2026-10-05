import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import Preview from './transfer-proposal.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'transfer-proposal',
  component: Preview,
  states: ['confirm', 'finalize-error'],
  widths: [420],
  selector: '[data-testid="transfer-proposal"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/transfer-proposal.geometry.json', import.meta.url),
  ),
});
