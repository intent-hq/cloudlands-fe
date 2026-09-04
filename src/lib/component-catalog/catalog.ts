import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import { m } from '$shared/paraglide/messages.js';

export interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  category: 'primitive' | 'pattern' | 'product';
  source: string;
  fixtures: UiComponentFixture[];
}

const componentEntries: CatalogEntry[] = canonicalComponentManifest.map((component) => ({
  slug: component.id,
  name: component.id
    .split('-')
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' '),
  description: `${component.owner} verification: ${component.removalGate}`,
  category: component.category as 'primitive' | 'pattern',
  source: component.source,
  fixtures: component.fixtures,
}));

export const catalogEntries: CatalogEntry[] = [
  ...componentEntries,
  {
    slug: 'new-workspace',
    get name() {
      return m.sandbox_newWorkspace_title();
    },
    get description() {
      return m.sandbox_newWorkspace_description();
    },
    category: 'product',
    source: 'src/features/new-workspace/sandbox',
    fixtures: [
      {
        id: 'scenario-registry',
        get title() {
          return m.sandbox_newWorkspace_allScenarios_label();
        },
        states: ['entry', 'capability', 'source', 'transaction', 'recovery'],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'chat-polish',
    name: m.sandbox_chatPolish_title(),
    description: m.sandbox_chatPolish_description(),
    category: 'product',
    source: 'src/lib/components/chat',
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
