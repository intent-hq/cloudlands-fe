import {
  EditableTextPreview,
  editableTextStates,
  GitHubLinkCardPreview,
  HeaderExample,
  IndicatorExample,
} from './shared-widget-catalog-preview';
import type { ComponentType, ReactNode } from 'react';
import { catalogEntries } from './catalog';
import { AvatarCatalogPreview } from './avatar-catalog-preview';
import { FieldsCatalogPreview } from './fields-catalog-preview';
import { RowsCatalogPreview } from './rows-catalog-preview';
import { MemoryCatalogPreview, memoryCatalogStates } from './memory-catalog-preview';
import {
  DiagramWorkbenchPreview,
  diagramWorkbenchStates,
  diagramWorkbenchCaptureReadiness,
} from './diagram-workbench-preview';
import type { PreviewCaptureReadiness } from '$lib/component-catalog/preview-definition';
import { m } from '$shared/paraglide/messages.js';
import { SidebarHarness, type SidebarHarnessProps } from '@/components/ui/sidebar';
import { askUserQuestionsFixtures } from '$lib/components/ui/ask-user-questions/ask-user-questions.fixtures';
import { messageComposerFixtures } from '$lib/components/ui/message-composer/message-composer.fixtures';
import { comboboxFixtures } from '$lib/components/ui/combobox/combobox.fixtures';
import { searchableSelectFixtures } from '$lib/components/ui/searchable-select/searchable-select.fixtures';
import { groupedComboboxFixtures } from '$lib/components/ui/grouped-combobox/grouped-combobox.fixtures';
import { listFixtures } from '$lib/components/ui/list/list.fixtures';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { QuestionsCatalogPreview } from './questions-catalog-preview';
import { ComposerCatalogPreview } from './composer-catalog-preview';
import { PickerCatalogPreview } from './picker-catalog-preview';
import { ListCatalogPreview } from './sidebar-catalog-preview';
import { DisplayWidgetExample } from './display-widget-examples';
import {
  MediaCatalogPreview,
  MediaHostExample,
  ShimmerCatalogPreview,
  ZoomMediaExample,
} from './media-catalog-preview';
import { RichTooltipSurfacePreview } from './overlay-interaction-examples';
import {
  FindBarExample,
  SidebarMenuExample,
  SmartTabsExample,
  SearchableComboboxExample,
} from './navigation-widget-examples';
import {
  additionalCatalogEntries,
  displayWidgetSlugs,
  richTooltipVariants,
} from './additional-catalog-entries';

export function AdditionalCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  if (componentId === 'github-link-card') return <GitHubLinkCardPreview state={fixture.id} />;
  if (componentId === 'content-header' || componentId === 'panel-wrapper')
    return <HeaderExample panel={componentId === 'panel-wrapper'} />;
  if (componentId === 'agent-badge' || componentId === 'unsaved-indicator')
    return <IndicatorExample unsaved={componentId === 'unsaved-indicator'} />;
  if (componentId === 'media-lightbox') return <MediaHostExample />;
  if (componentId === 'zoom-pan-viewport') return <ZoomMediaExample />;
  if (componentId === 'shimmer-overlay') return <ShimmerCatalogPreview />;
  if (displayWidgetSlugs.some((slug) => slug === componentId))
    return <DisplayWidgetExample slug={componentId} />;
  if (componentId === 'tooltip-rich') {
    const variant = richTooltipVariants.find((value) => value === fixture.id);
    return variant ? <RichTooltipSurfacePreview variant={variant} /> : null;
  }
  if (componentId === 'sidebar-context-menu')
    return (
      <SidebarMenuExample
        edge={fixture.id === 'edge'}
        long={fixture.id === 'long'}
        multiline={fixture.id === 'multiline'}
      />
    );
  if (componentId === 'panel-find-bar') return <FindBarExample />;
  if (componentId === 'smart-corner-tabs') return <SmartTabsExample />;
  if (componentId === 'searchable-combobox') return <SearchableComboboxExample />;
  return null;
}

interface Definition {
  id: string;
  title: string;
  source: string;
  defaultState: string;
  unportedStates?: readonly string[];
  captureReadiness?: PreviewCaptureReadiness;
  states: Record<string, ReactNode>;
}
function fixturePreview(
  id: string,
  title: string,
  source: string,
  fixtures: readonly UiComponentFixture[],
  Component: ComponentType<{ fixture: UiComponentFixture }>,
): Definition {
  return {
    id,
    title,
    source,
    defaultState: fixtures[0]!.id,
    states: Object.fromEntries(
      fixtures.map((fixture) => [fixture.id, <Component key={fixture.id} fixture={fixture} />]),
    ),
  };
}
function ComboboxPreview({ fixture }: { fixture: UiComponentFixture }) {
  return <PickerCatalogPreview componentId="combobox" fixture={fixture} />;
}
function SearchableSelectPreview({ fixture }: { fixture: UiComponentFixture }) {
  return <PickerCatalogPreview componentId="searchable-select" fixture={fixture} />;
}
function GroupedComboboxPreview({ fixture }: { fixture: UiComponentFixture }) {
  return <PickerCatalogPreview componentId="grouped-combobox" fixture={fixture} />;
}

// Exact state names and props from sidebar.preview.ts. Harness stays persist=false.
const sidebarStates = {
  default: { open: true, fixtureState: 'default' },
  floating: { open: true, variant: 'floating', fixtureState: 'floating' },
  inset: { open: true, variant: 'inset', fixtureState: 'inset' },
  nested: { open: true, fixtureState: 'nested' },
  'actions-and-badges': { open: true, fixtureState: 'actions-and-badges' },
  'header-footer-stacking': { open: true, fixtureState: 'header-footer-stacking' },
  callouts: { open: true, fixtureState: 'callouts' },
  'status-dots': { open: true, fixtureState: 'status-dots' },
  skeleton: { open: true, fixtureState: 'skeleton' },
  compact: { open: true, fixtureState: 'compact' },
  collapsed: { open: false, fixtureState: 'collapsed' },
  'peek-hover': { open: false, peek: 'hover', fixtureState: 'peek-hover' },
  resizing: { open: true, fixtureState: 'resizing' },
  'reduced-motion': { open: true, fixtureState: 'default' },
} satisfies Record<string, SidebarHarnessProps>;

const composedPreviews: Record<string, ComponentType<{ fixture: UiComponentFixture }>> = {
  fields: FieldsCatalogPreview,
  rows: RowsCatalogPreview,
  'principal-avatar': AvatarCatalogPreview,
};

export const additionalPreviews: Record<string, Definition> = {
  'diagram-workbench': {
    id: 'diagram-workbench',
    get title() {
      return m.sandbox_diagramWorkbench_title();
    },
    source: 'src/lib/components/diagrams/diagram-workbench.preview.svelte',
    defaultState: 'mermaid-flow',
    captureReadiness: diagramWorkbenchCaptureReadiness,
    states: Object.fromEntries(
      diagramWorkbenchStates.map((state) => [
        state,
        <DiagramWorkbenchPreview key={state} state={state} />,
      ]),
    ),
  },
  ...Object.fromEntries(
    catalogEntries
      .filter((entry) => composedPreviews[entry.slug])
      .map((entry) => [
        entry.slug,
        fixturePreview(
          entry.slug,
          entry.name,
          entry.slug === 'principal-avatar'
            ? 'src/lib/component-catalog/renderers/PrincipalAvatarCatalogPreview.svelte'
            : entry.source,
          entry.fixtures,
          composedPreviews[entry.slug]!,
        ),
      ]),
  ),
  'editable-text': {
    id: 'editable-text',
    title: 'Editable text (partial)',
    source: 'src/lib/components/ui/editable-text.preview.svelte',
    defaultState: 'display',
    states: Object.fromEntries(
      editableTextStates.map((state) => [state, <EditableTextPreview key={state} state={state} />]),
    ),
  },
  'diagnostics-audit': {
    id: 'diagnostics-audit',
    title: 'Diagnostic and specialized modal audit (partial)',
    source: 'src/lib/components/modals/diagnostics-audit.preview.svelte',
    defaultState: 'memory',
    unportedStates: ['new-workspace'],
    states: {
      ...Object.fromEntries(
        memoryCatalogStates.map((state) => [
          state,
          <MemoryCatalogPreview key={state} state={state} />,
        ]),
      ),
      media: <MediaCatalogPreview />,
      'media-long': <MediaCatalogPreview long />,
    },
  },
  'ask-user-questions': fixturePreview(
    'ask-user-questions',
    'Ask user questions',
    'src/lib/component-catalog/renderers/AskUserQuestionsCatalogPreview.svelte',
    askUserQuestionsFixtures,
    QuestionsCatalogPreview,
  ),
  'message-composer': fixturePreview(
    'message-composer',
    'Message composer',
    'src/lib/component-catalog/renderers/MessageComposerCatalogPreview.svelte',
    messageComposerFixtures,
    ComposerCatalogPreview,
  ),
  combobox: fixturePreview(
    'combobox',
    'Combobox',
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    comboboxFixtures,
    ComboboxPreview,
  ),
  'searchable-select': fixturePreview(
    'searchable-select',
    'Searchable select',
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    searchableSelectFixtures,
    SearchableSelectPreview,
  ),
  'grouped-combobox': fixturePreview(
    'grouped-combobox',
    'Grouped combobox',
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    groupedComboboxFixtures,
    GroupedComboboxPreview,
  ),
  list: fixturePreview(
    'list',
    'List',
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    listFixtures,
    ListCatalogPreview,
  ),
  sidebar: {
    id: 'sidebar',
    title: 'Sidebar',
    source: 'src/lib/components/ui/sidebar/sidebar.preview.ts',
    defaultState: 'default',
    states: Object.fromEntries(
      Object.entries(sidebarStates).map(([name, props]) => [
        name,
        <SidebarHarness key={name} {...props} insetAs="div" />,
      ]),
    ),
  },
  ...Object.fromEntries(
    additionalCatalogEntries.map((entry) => [
      entry.slug,
      {
        id: entry.slug,
        title: entry.name,
        source: entry.source,
        defaultState: entry.slug === 'github-link-card' ? 'pr-open' : entry.fixtures[0]!.id,
        states: Object.fromEntries(
          entry.fixtures.map((fixture) => [
            fixture.id,
            <AdditionalCatalogPreview
              key={fixture.id}
              componentId={entry.slug}
              fixture={fixture}
            />,
          ]),
        ),
      },
    ]),
  ),
};
