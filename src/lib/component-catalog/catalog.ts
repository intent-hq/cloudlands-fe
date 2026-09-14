import { buttonMetadata } from '$lib/components/ui/button/button.meta';
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
  usage?: string;
  props?: CatalogProp[];
}

export interface CatalogProp {
  name: string;
  type: string;
  defaultValue: string;
  description: string;
}

export const commonProps: CatalogProp[] = [
  { name: 'class', type: 'string', defaultValue: '—', description: 'Additional utility classes.' },
  {
    name: 'children',
    type: 'Snippet',
    defaultValue: '—',
    description: 'Rendered component content.',
  },
];

const componentProps: Record<string, CatalogProp[]> = {
  card: [
    {
      name: 'Group.orientation',
      type: "'card' | 'inline'",
      defaultValue: "'card'",
      description: 'Stack each card vertically or place its media beside the text.',
    },
    {
      name: 'Group.columns',
      type: 'number',
      defaultValue: '1',
      description: 'Number of equal-width columns in the group.',
    },
    {
      name: 'border',
      type: "'none' | 'outlined'",
      defaultValue: 'standalone: outlined; group: none',
      description: 'Show a shared group frame or an individual card surface.',
    },
    {
      name: 'Group.separated',
      type: 'boolean',
      defaultValue: 'false',
      description: 'Space individual card surfaces apart.',
    },
    {
      name: 'Group.divided',
      type: 'boolean',
      defaultValue: 'true',
      description: 'Draw hairline dividers inside a continuous group.',
    },
    {
      name: 'Group.fluidHover',
      type: 'boolean',
      defaultValue: 'true',
      description: 'Move a shared highlight to the nearest card.',
    },
    {
      name: 'Group.selected',
      type: 'number',
      defaultValue: '-1',
      description: 'Index of a persistently highlighted card.',
    },
    {
      name: 'Root.selected',
      type: 'boolean',
      defaultValue: 'false',
      description: 'Keep this card highlighted.',
    },
    {
      name: 'Root.media',
      type: 'Snippet',
      defaultValue: '—',
      description: 'Optional leading icon or media content.',
    },
    ...commonProps,
  ],
  'input-message': [
    {
      name: 'tone',
      type: "'helper' | 'error'",
      defaultValue: "'helper'",
      description: 'Helper text announces politely; errors use an alert and danger text.',
    },
    {
      name: 'id',
      type: 'string',
      defaultValue: '—',
      description: 'Connect the message to an input with aria-describedby.',
    },
    ...commonProps,
  ],
  button: [
    {
      name: 'variant',
      type: "'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline'",
      defaultValue: "'default' (secondary)",
      description: 'Canonical emphasis; outline is the supplemental bordered treatment.',
    },
    {
      name: 'size',
      type: 'ButtonSize',
      defaultValue: 'context',
      description: 'Supported sizes: sm, default, lg; icon-sm, icon, icon-lg.',
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
    ...(buttonMetadata.apiGuidance?.compatibilityAliases ?? []).map(
      ({ prop, alias, replacement }) => ({
        name: `${prop}="${alias}"`,
        type: 'Compatibility alias',
        defaultValue: '—',
        description: `Deprecated — use ${prop}="${replacement}".`,
      }),
    ),
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

const componentDescriptions: Record<string, string> = {
  accordion: 'Reveal supporting sections while keeping their headings easy to scan.',
  badge:
    'Show neutral, information, success, warning, or danger status; use categorical colours only for categorisation.',
  breadcrumb: 'Show the path to the current page and navigate its ancestors.',
  checkbox: 'Turn an independent option on or off.',
  'checkbox-group': 'Choose several related options from a labelled group.',
  'copy-input': 'Show a value with an action to copy it to the clipboard.',
  dialog: 'Collect a focused decision in a modal dialog.',
  'file-input': 'Choose files and show selection, upload progress, and validation feedback.',
  input: 'Enter a single line of text with optional validation feedback.',
  'input-group': 'Attach labels or actions to a shared input surface.',
  kbd: 'Display a keyboard key or shortcut beside an action.',
  label: 'Name a form control and connect its label to the input.',
  list: 'Arrange items with selection, icons, metadata, and row actions.',
  menu: 'Offer related commands in a keyboard-accessible floating menu.',
  'proximity-highlight': 'Move a shared highlight between nearby or selected items.',
  'radio-group': 'Choose exactly one option from a related set.',
  'scroll-area': 'Keep overflowing content accessible within a bounded viewport.',
  select: 'Choose one value from a fixed list of options.',
  separator: 'Separate adjacent sections with a quiet rule.',
  sheet: 'Show supporting content in a panel attached to the viewport edge.',
  sidebar: 'Organize primary navigation in an expandable side rail.',
  skeleton: 'Reserve content geometry while data is loading.',
  slider: 'Adjust a numeric value along a bounded range.',
  switch: 'Enable or disable a setting immediately.',
  table: 'Compare structured records across labelled columns.',
  tabs: 'Switch between related views within one section.',
  textarea: 'Enter multiple lines of text with field feedback.',
  toast: 'Show brief feedback without interrupting the current task.',
  toggle: 'Switch an individual action between pressed and unpressed states.',
  'toggle-group': 'Choose among a group of related pressed actions.',
  tooltip: 'Explain a control on pointer hover or keyboard focus.',
  combobox: 'Search available options and choose a matching value.',
  'searchable-select': 'Filter a selection list before choosing a value.',
  'grouped-combobox': 'Search and choose options organized into collapsible groups.',
  dropdown: 'Search or browse options in a floating selection list.',
  'settings-page-shell': 'Lay out a settings page with consistent section spacing.',
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
    componentDescriptions[component.id] ??
    `Composable ${displayName(component.id).toLowerCase()} building blocks for consistent product interfaces.`,
  category: component.category,
  source: component.source,
  fixtures: component.fixtures,
  publicImport: component.publicImport,
  exports: component.exports,
  usage: component.usage,
  props: componentProps[component.id] ?? commonProps,
}));

export const catalogEntries: CatalogEntry[] = [
  ...componentEntries,
  {
    slug: 'model-picker',
    name: 'Model picker',
    description: 'Choose a provider model from a searchable list using deterministic preview data.',
    category: 'product',
    source: 'src/lib/components/chat/input/ModelPicker.svelte',
    exports: ['ModelPicker'],
    fixtures: [
      {
        id: 'populated',
        title: 'Model selection',
        states: ['closed', 'open', 'empty'],
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
          'confirm-host-confirm',
          'confirm-host-prompt',
          'confirm-host-alert',
          'confirm-host-busy',
          'workspace-warning-dialogs',
          'setup-prompt-dialog',
          'pull-conflict-dialog',
          'feature-code-dialog',
          'directory-picker-modal',
          'set-primary-client-confirm-dialog',
          'new-space-modal',
          'setup-script-modal',
          'interrupted-agents-modal',
          'add-remote-setup-modal',
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
    slug: 'fields',
    name: 'Composed form fields',
    description:
      'Full field-row compositions across control, interaction, validation, density, and zoom states.',
    category: 'product',
    source: 'src/lib/component-catalog/renderers/FieldsCatalogPreview.svelte',
    publicImport: '$lib/components/patterns/form',
    exports: ['FormRow', 'FormField', 'SettingsFieldRow'],
    props: commonProps,
    fixtures: [
      {
        id: 'field-state-matrix',
        title: 'Composed field state matrix',
        states: [
          'empty-placeholder',
          'filled',
          'hover',
          'focus-visible',
          'invalid',
          'disabled',
          'read-only',
          'help-text',
          'required',
          'long-label',
          'compact-density',
          'zoom-200',
        ],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'rows',
    name: 'Rows and collections',
    description:
      'Static row-family matrices for comparing collection, sidebar, settings, table, menu, and tab-strip geometry.',
    category: 'product',
    source: 'src/lib/component-catalog/renderers/RowsCatalogPreview.svelte',
    publicImport: '$lib/components/patterns/collection',
    exports: ['ListRow', 'SectionedList', 'DataList', 'RowActions'],
    props: commonProps,
    fixtures: [
      {
        id: 'row-family-matrix',
        title: 'List rows and collections',
        states: [
          'default',
          'hover',
          'focus-visible',
          'selected',
          'active-current',
          'disabled',
          'busy-loading',
          'unread-attention',
          'trailing-actions',
          'dragging-placeholder',
          'long-content',
          'compact-density',
          'zoom-200',
          'baseline-grid',
        ],
        themes: ['light', 'dark'],
        viewport: 'both',
        reducedMotion: true,
      },
    ],
  } satisfies CatalogEntry,
  {
    slug: 'screen-states',
    name: 'Screen and feedback states',
    description:
      'Blank, error, loading, notice, unavailable-content, and composed screen states at wide and narrow widths.',
    category: 'product',
    source: 'src/lib/component-catalog/renderers/ScreenStatesCatalogPreview.svelte',
    publicImport: '$lib/components/patterns/screen',
    exports: ['EmptyState', 'ErrorState', 'LoadingState', 'TakeoverScreen', 'Screen'],
    props: commonProps,
    fixtures: [
      {
        id: 'screen-feedback-state-matrix',
        title: 'Screen and feedback state matrix',
        states: [
          'screen-composition',
          'takeover',
          'empty',
          'error',
          'loading',
          'skeleton-text',
          'skeleton-avatar',
          'skeleton-card',
          'skeleton-list',
          'loading-indicator',
          'notice-banner',
          'notice-inline',
          'media-unavailable',
          'notify-error-toast',
          'short-copy',
          'long-copy',
          'with-icon',
          'without-icon',
          'primary-action',
          'secondary-action',
          'no-action',
          'width-320',
          'full-width',
          'compact-density',
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
