export const uiComponentGuardrails = {
  // `<Button>` usages that pass an opaque `bg-<token>` class (no `/opacity`, no state prefix)
  // without a `variant`. Button paints its surface on an inner span that covers class-level
  // backgrounds, so such callers render the default surface with the accent's foreground
  // (near-black, unreadable in dark mode). Route accent buttons through `variant=` instead.
  buttonBackgroundOverrides: 0,
  internalImports: {
    '$lib/components/ui/button/button.svelte': 18,
    '$lib/components/ui/button/index.js': 1,
    '$lib/components/ui/checkbox/checkbox.svelte': 2,
    '$lib/components/ui/input/index.js': 1,
    '$lib/components/ui/input/input.svelte': 5,
    '$lib/components/ui/label/label.svelte': 1,
    '$lib/components/ui/separator/index.js': 1,
    '$lib/components/ui/sheet/index.js': 1,
    '$lib/components/ui/skeleton/index.js': 1,
    '$lib/components/ui/skeleton/skeleton.svelte': 2,
    '$lib/components/ui/switch/switch.svelte': 2,
    '$lib/components/ui/textarea/textarea.svelte': 1,
    '$lib/components/ui/toast/Toast.svelte': 1,
    '$lib/components/ui/tooltip/LinkTooltip.svelte': 1,
    '$lib/components/ui/tooltip/Tooltip.svelte': 5,
    '$lib/components/ui/tooltip/TooltipRich.svelte': 1,
    '$lib/components/ui/tooltip/github-link-card.preview.svelte': 1,
    '$lib/components/ui/tooltip/index.js': 2,
    '$lib/components/ui/tooltip/link-tooltip-state.svelte': 1,
    'relative:src/lib/components/ui/Header.svelte': 2,
    'relative:src/lib/components/ui/MediaLightbox.svelte': 1,
    'relative:src/lib/components/ui/Portal.svelte': 3,
    'relative:src/lib/components/ui/button/button.svelte': 7,
    'relative:src/lib/components/ui/checkbox/checkbox.svelte': 1,
    'relative:src/lib/components/ui/combobox/index.ts': 3,
    'relative:src/lib/components/ui/dropdown-menu.svelte': 1,
    'relative:src/lib/components/ui/dialog/overlay-motion.svelte.ts': 2,
    'relative:src/lib/components/ui/dialog/overlay-root.svelte': 1,
    'relative:src/lib/components/ui/input/input.svelte': 1,
    'relative:src/lib/components/ui/menu/index.ts': 1,
    'relative:src/lib/components/ui/menu/menu-list-highlight.svelte': 3,
    'relative:src/lib/components/ui/menu/menu-recipes.ts': 5,
    'relative:src/lib/components/ui/skeleton/index.ts': 1,
    'relative:src/lib/components/ui/surface-context.ts': 1,
    'relative:src/lib/components/ui/tooltip/Tooltip.svelte': 2,
  },
  patternAdoption: {
    // Baseline the 11 existing dialogs; none is a branch-introduced form-dialog candidate.
    formDialog: 11,
    // 33 = the 31 surfaces baselined at 388bffff2 plus main's #2074 ExecutionPlanCard.svelte
    // and TaskProgressControl.svelte, which landed before this ratchet existed.
    listView: 33,
    screen: 9,
    settingsForm: 1,
  },
  rawControls: { button: 0, input: 0, select: 0, textarea: 0 },
  // Raw `<img src={…avatarUrl…}>` outside `src/lib/components/ui/PrincipalAvatar.svelte`. A
  // hand-rolled avatar image has no load-failure fallback (cloudlands-fe#2774 review), so every
  // principal avatar renders through the shared PrincipalAvatar component.
  rawPrincipalAvatarImages: 0,
} as const;
