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
      type: "'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'",
      defaultValue: "'default'",
      description: 'Visual treatment for the action.',
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
