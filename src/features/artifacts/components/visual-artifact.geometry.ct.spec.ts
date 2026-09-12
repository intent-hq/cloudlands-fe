import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ArtifactPreview from './visual-artifact.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'visual-artifact',
  component: ArtifactPreview,
  states: ['board', 'image', 'options', 'preview'],
  widths: [720],
  selector: '.artifact-editor',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/visual-artifact.geometry.json', import.meta.url),
  ),
});
