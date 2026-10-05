export const legacyOverlayDeprecations = [
  {
    legacyImport: '$lib/components/layout/Drawer.svelte',
    replacement: '$lib/components/ui/sheet',
    callers: [],
    characterizationTest:
      'src/lib/components/modals/__tests__/LegacyOverlayCharacterization.test.ts',
    removalGate: 'No product callers remain; retain only for Drawer characterization tests.',
  },
] as const;
