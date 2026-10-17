import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ProjectPickerMessage from './ProjectPickerMessage.svelte';

defineGeometrySnapshotSuite({
  scene: 'onboarding-repo-picker',
  component: ProjectPickerMessage,
  states: ['discovering', 'discovered', 'empty', 'error'],
  widths: [600],
  selector: '[data-message], h2, p, button, [role="combobox"], [role="listbox"], [role="status"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/onboarding-repo-picker.geometry.json', import.meta.url),
  ),
});
