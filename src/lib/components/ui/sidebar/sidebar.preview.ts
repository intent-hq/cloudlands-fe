import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import SidebarHarness from './SidebarHarness.svelte';

type SidebarHarnessProps = ComponentProps<typeof SidebarHarness>;

export const preview = definePreview<SidebarHarnessProps>({
  id: 'sidebar',
  title: 'Sidebar',
  defaultState: 'default',
  states: {
    default: { props: { open: true, fixtureState: 'default' } },
    floating: { props: { open: true, variant: 'floating', fixtureState: 'floating' } },
    inset: { props: { open: true, variant: 'inset', fixtureState: 'inset' } },
    nested: { props: { open: true, fixtureState: 'nested' } },
    'actions-and-badges': { props: { open: true, fixtureState: 'actions-and-badges' } },
    'header-footer-stacking': {
      props: { open: true, fixtureState: 'header-footer-stacking' },
    },
    callouts: { props: { open: true, fixtureState: 'callouts' } },
    'status-dots': { props: { open: true, fixtureState: 'status-dots' } },
    skeleton: { props: { open: true, fixtureState: 'skeleton' } },
    compact: { props: { open: true, fixtureState: 'compact' } },
    collapsed: { props: { open: false, fixtureState: 'collapsed' } },
    'peek-hover': { props: { open: false, peek: 'hover', fixtureState: 'peek-hover' } },
    resizing: { props: { open: true, fixtureState: 'resizing' } },
    'reduced-motion': { props: { open: true, fixtureState: 'default' } },
  },
});

export default SidebarHarness;
