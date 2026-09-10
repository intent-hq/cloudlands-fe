import type {
  UiComponentCategory,
  UiComponentFixture,
} from '$lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import { m } from '$shared/paraglide/messages.js';

export interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  category: UiComponentCategory;
  source: string;
  fixtures: UiComponentFixture[];
  publicImport?: string;
  exports?: string[];
  props?: CatalogProp[];
}

export interface CatalogProp {
  name: string;
  type: string;
  defaultValue: string;
  description: string;
}

const commonProps: CatalogProp[] = [
  { name: 'class', type: 'string', defaultValue: '—', description: 'Additional utility classes.' },
  {
    name: 'children',
    type: 'Snippet',
    defaultValue: '—',
    description: 'Rendered component content.',
  },
];

const componentProps: Record<string, CatalogProp[]> = {
  button: [
    {
      name: 'variant',
      type: "'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline'",
      defaultValue: "'primary'",
      description: 'Canonical emphasis; outline is the supplemental bordered treatment.',
    },
    {
      name: 'size',
      type: 'ButtonSize',
      defaultValue: 'context',
      description: 'Control height and icon scale.',
    },
    {
      name: 'loading',
      type: 'boolean',
      defaultValue: 'false',
      description: 'Shows progress and disables activation.',
    },
    {
      name: 'active',
      type: 'boolean',
      defaultValue: 'false',
      description: 'Keeps the pressed treatment visible.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      defaultValue: 'false',
      description: 'Prevents interaction.',
    },
    ...commonProps,
  ],
  sidebar: [
    {
      name: 'side',
      type: "'left' | 'right'",
      defaultValue: "'left'",
      description: 'Edge used by the navigation rail.',
    },
    {
      name: 'variant',
      type: "'sidebar' | 'floating' | 'inset'",
      defaultValue: "'sidebar'",
      description: 'Surface relationship to its content.',
    },
    {
      name: 'collapsible',
      type: "'offcanvas' | 'icon' | 'none'",
      defaultValue: "'offcanvas'",
      description: 'Collapsed navigation behavior.',
    },
    {
      name: 'rail',
      type: 'boolean',
      defaultValue: 'true',
      description: 'Shows the resize and reveal rail.',
    },
    ...commonProps,
  ],
};

function displayName(id: string): string {
  if (id === 'loading-indicator') return 'Loading indicator';
  return id
    .split('-')
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

const componentEntries: CatalogEntry[] = canonicalComponentManifest.map((component) => ({
  slug: component.id,
  name: displayName(component.id),
  description:
    component.useWhen?.[0] ??
    `Composable ${displayName(component.id).toLowerCase()} building blocks for consistent product interfaces.`,
  category: component.category,
  source: component.source,
  fixtures: component.fixtures,
  publicImport: component.publicImport,
  exports: component.exports,
  props: componentProps[component.id] ?? commonProps,
}));

export const catalogEntries: CatalogEntry[] = [
  ...componentEntries,
  {
    slug: 'chat-polish',
    name: m.sandbox_chatPolish_title(),
    description: m.sandbox_chatPolish_description(),
    category: 'product',
    source: 'src/lib/components/chat',
    publicImport: '$lib/components/chat',
    exports: ['ChatMessage'],
    props: commonProps,
    fixtures: [
      {
        id: 'comprehensive-conversation',
        title: m.sandbox_chatPolish_mixedReviewComplete_title(),
        states: ['comprehensive', 'deterministic', 'daemon-free', 'read-only'],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'modals',
    name: 'Modals',
    description:
      'Static modal state matrices for reviewing shared dialog and product compositions.',
    category: 'product',
    source: 'src/lib/component-catalog/renderers/ModalCatalogPreview.svelte',
    publicImport: '$lib/components/ui/dialog',
    exports: ['Dialog'],
    props: commonProps,
    fixtures: [
      {
        id: 'primitive-dialog-matrix',
        title: 'Dialog primitive',
        states: [
          'default',
          'no-description',
          'title-only',
          'with-icon-header',
          'size-sm',
          'size-lg',
          'compact-density',
          'long-content-scrolling',
          'busy',
          'invalid',
          'destructive',
          'disabled-close',
          'nested-content',
          'zoom-200',
          'reduced-motion',
        ],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
      {
        id: 'product-modal-matrix',
        title: 'Product modals',
        states: [
          'destructive-confirm-default',
          'destructive-confirm-typed-name',
          'destructive-confirm-busy',
          'form-dialog-default',
          'form-dialog-busy',
          'form-dialog-invalid',
          'input-dialog',
          'message-dialog',
          'delete-warning-dialog',
          'bulk-action-confirm-dialog',
          'quit-confirmation-modal',
          'replace-agent-modal',
          'release-notes-modal',
          'import-workspace-modal',
          'transfer-workspace-modal',
          'harness-features-modal',
          'model-switch-confirm-dialog',
          'dismiss-proposal-confirm-dialog',
          'dismiss-questions-confirm-dialog',
        ],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'popovers',
    name: 'Menus and popovers',
    description:
      'Static non-modal overlay matrices for reviewing shared menu, listbox, popover, hover-card, and tooltip contracts.',
    category: 'product',
    source: 'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
    publicImport: '$lib/components/ui',
    exports: ['Menu', 'Dropdown', 'Select', 'Combobox', 'Popover', 'HoverCard', 'Tooltip'],
    props: commonProps,
    fixtures: [
      {
        id: 'non-modal-overlay-matrix',
        title: 'Open non-modal overlays',
        states: [
          'menu-item-states',
          'long-menu',
          'compact-density',
          'dropdown-menu',
          'select-listbox',
          'combobox-listbox',
          'empty-search',
          'grouped',
          'popover-title-body',
          'popover-form',
          'popover-footer',
          'workspace-hover-card',
          'github-link-card',
          'tooltip-short',
          'tooltip-multi-line',
          'tooltip-kbd',
          'zoom-200',
          'reduced-motion',
        ],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'proposal-card',
    name: 'Proposal Card',
    description: 'Static proposal presentation contracts without application state or daemon data.',
    category: 'product',
    source: 'src/lib/components/chat/proposals',
    publicImport: '$lib/components/chat/proposals',
    exports: ['ProposalCard'],
    props: commonProps,
    fixtures: [
      {
        id: 'pending-settings-change',
        title: 'Pending settings change',
        states: ['default', 'editable', 'long-content'],
        themes: ['light', 'dark'],
        viewport: 'both',
      },
      {
        id: 'applied-with-undo',
        title: 'Applied with undo',
        states: ['success', 'disabled'],
        themes: ['light', 'dark'],
        viewport: 'both',
      },
      {
        id: 'bulk-operation-warning',
        title: 'Bulk operation warning',
        states: ['warning', 'mixed-selection', 'long-content'],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
].sort((left, right) => left.slug.localeCompare(right.slug));

export function getCatalogEntry(slug: string): CatalogEntry | undefined {
  return catalogEntries.find((entry) => entry.slug === slug);
}
