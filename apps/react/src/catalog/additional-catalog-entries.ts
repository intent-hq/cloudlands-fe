// Supplemental public ports without canonical catalog metadata. Descriptions distinguish
// translated source harnesses from new interaction callers; none claims accepted parity.
// i18n-ignore (internal catalog reference descriptions)
import { githubLinkCardStates } from './shared-widget-catalog-preview';
import type { CatalogEntry } from './catalog';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const displayWidgetSlugs = [
  'portal',
  'relative-time',
  'animated-number',
  'editable-name',
  'github-avatar',
  'hover-card',
  'virtual-list',
] as const;
export const richTooltipVariants = ['default', 'info', 'success', 'warning', 'error'] as const;
const widgets = [
  ['portal', 'Portal'],
  ['relative-time', 'RelativeTime'],
  ['animated-number', 'AnimatedNumber'],
  ['editable-name', 'EditableName'],
  ['github-avatar', 'GitHubAvatar'],
  ['hover-card', 'HoverCard'],
  ['virtual-list', 'VirtualList'],
] as const;
export const interactionFixture: UiComponentFixture = {
  id: 'interaction-example',
  title: 'Additional interaction example',
  states: ['interaction-example'],
  themes: ['light', 'dark'],
  viewport: 'both',
  reducedMotion: true,
};
export const additionalCatalogEntries: CatalogEntry[] = [
  {
    slug: 'github-link-card',
    name: 'GitHubLinkCard',
    category: 'primitive',
    source: 'src/lib/components/ui/tooltip/github-link-card.preview.svelte',
    publicImport: '@/components/ui/github-link-card',
    exports: ['GitHubLinkCard'],
    description:
      'All sixteen source display inputs. The separate /sandbox/link-tooltip?example=live route exercises the real tooltip and backend; backend and visual acceptance remain pending.',
    fixtures: githubLinkCardStates.map((id) => ({ id, title: id, states: [id] })),
  },
  ...[
    [
      'content-header',
      'ContentHeader',
      'src/features/layout/components/content-header/ContentHeader.svelte',
      '@/features/layout/components/content-header',
    ],
    [
      'panel-wrapper',
      'PanelWrapper',
      'src/lib/components/ui/PanelWrapper.svelte',
      '@/components/ui/panel-wrapper',
    ],
    [
      'agent-badge',
      'AgentBadge',
      'src/lib/components/ui/indicators/AgentBadge.svelte',
      '@/components/ui/indicators',
    ],
    [
      'unsaved-indicator',
      'UnsavedIndicator',
      'src/lib/components/ui/indicators/UnsavedIndicator.svelte',
      '@/components/ui/indicators',
    ],
  ].map(([slug, name, source, publicImport]): CatalogEntry => ({
    slug: slug!,
    name: name!,
    source: source!,
    publicImport: publicImport!,
    exports: [name!],
    category: 'primitive',
    description:
      'Additional observable interaction caller using the real source port. No complete source scene or accepted visual parity is claimed.',
    fixtures: [interactionFixture],
  })),
  {
    slug: 'media-lightbox',
    name: 'MediaLightbox',
    category: 'primitive',
    source: 'src/lib/components/ui/__tests__/MediaLightbox.test-harness.svelte',
    publicImport: '@/components/ui/media-lightbox',
    exports: ['MediaLightbox'],
    description:
      'Source lightbox interaction harness with the shared Button trigger. Exact open appearance states are diagnostics-audit media and media-long; memory and new-workspace states remain unported.',
    fixtures: [interactionFixture],
  },
  {
    slug: 'zoom-pan-viewport',
    name: 'ZoomPanViewport',
    category: 'primitive',
    source: 'src/lib/components/ui/ZoomPanViewport.svelte',
    publicImport: '@/components/ui/zoom-pan-viewport',
    exports: ['ZoomPanViewport'],
    description:
      'Additional real image and lightbox interaction example. No reference catalog scene.',
    fixtures: [interactionFixture],
  },
  {
    slug: 'shimmer-overlay',
    name: 'ShimmerOverlay',
    category: 'primitive',
    source: 'src/lib/components/ui/__tests__/ShimmerOverlayHost.svelte',
    publicImport: '@/components/ui/shimmer-overlay',
    exports: ['ShimmerOverlay'],
    description:
      'Exact source browser host for text and overlay modes. No registered source sandbox scene.',
    fixtures: [{ id: 'source-host', title: 'Text and overlay', states: ['source-host'] }],
  },
  ...widgets.map(([slug, name]): CatalogEntry => ({
    slug,
    name,
    category: 'primitive',
    source: `src/lib/components/ui/${name}.svelte`,
    publicImport: `@/components/ui/${slug}`,
    exports: [name],
    description:
      'Additional real-interaction caller for a source widget without a reference catalog scene. Visual parity remains unverified.',
    fixtures: [interactionFixture],
  })),
  {
    slug: 'tooltip-rich',
    name: 'TooltipRich',
    category: 'primitive',
    source: 'src/lib/components/ui/tooltip/TooltipSurfaceHarness.svelte',
    publicImport: '@/components/ui/tooltip-rich',
    exports: ['TooltipRich'],
    description:
      'The five non-product surface cases from TooltipSurfaceHarness. DrivingClientIndicator remains unported. Live LinkTooltip has a separate /sandbox/link-tooltip?example=live exercise.',
    fixtures: richTooltipVariants.map((variant) => ({
      id: variant,
      title: `${variant} surface`,
      states: [variant],
      themes: ['light', 'dark'],
      viewport: 'both',
    })),
  },
  {
    slug: 'sidebar-context-menu',
    name: 'SidebarContextMenu',
    category: 'primitive',
    source: 'src/lib/components/ui/sidebar-context-menu/SidebarMenuHarness.svelte',
    publicImport: '@/components/ui/sidebar-context-menu',
    exports: ['SidebarContextMenu', 'SidebarOverflowMenu'],
    description:
      'Source menu harness with real context and overflow triggers, checked choices and nested commands.',
    fixtures: ['default', 'edge', 'long', 'multiline'].map((id) => ({
      id,
      title: `${id} menu`,
      states: [id],
      themes: ['light', 'dark'],
      viewport: 'both',
    })),
  },
  {
    slug: 'panel-find-bar',
    name: 'PanelFindBar',
    category: 'primitive',
    source: 'src/lib/components/ui/panel-find-bar/__tests__/PanelFindBarTestHarness.svelte',
    publicImport: '@/components/ui/panel-find-bar',
    exports: ['PanelFindBar'],
    description:
      'Source test-harness composition with observable query, navigation and dismissal callbacks. No reference catalog scene.',
    fixtures: [interactionFixture],
  },
  {
    slug: 'smart-corner-tabs',
    name: 'SmartCornerTabs',
    category: 'primitive',
    source: 'src/lib/components/ui/smart-corner-tabs/SmartCornerTabs.svelte',
    publicImport: '@/components/ui/smart-corner-tabs',
    exports: ['SmartCornerTabs'],
    description:
      'Additional keyboard and selection example using the source test tab model. No reference catalog scene.',
    fixtures: [interactionFixture],
  },
  {
    slug: 'searchable-combobox',
    name: 'SearchableCombobox',
    category: 'deprecated-wrapper',
    source: 'src/lib/components/ui/searchable-combobox/searchable-combobox.svelte',
    publicImport: '@/components/ui/searchable-combobox',
    exports: ['SearchableCombobox'],
    description:
      'Additional compatibility-wrapper selection and rename example. No reference catalog scene; prefer Combobox for new callers.',
    fixtures: [interactionFixture],
  },
];
