export const legacyOverlayDeprecations = [
  {
    legacyImport: '$lib/components/modals/Modal.svelte',
    replacement: '$lib/components/ui/dialog',
    callers: ['src/lib/components/modals/SetupScriptModal.svelte'],
    characterizationTest:
      'src/lib/components/modals/__tests__/LegacyOverlayCharacterization.test.ts',
    removalGate: 'Remove after SetupScriptModal migrates and Dialog behavior tests remain green.',
  },
  {
    legacyImport: '$lib/components/layout/Drawer.svelte',
    replacement: '$lib/components/ui/sheet',
    callers: ['src/lib/components/layout/index.ts'],
    characterizationTest:
      'src/lib/components/modals/__tests__/LegacyOverlayCharacterization.test.ts',
    removalGate: 'Remove after the legacy layout export has zero static and dynamic consumers.',
  },
] as const;
