// Only executable React scenes are registered. Metadata is not proof of a port.
import type { ComponentProps, ReactNode } from 'react';
import { SettingsTextareaPreview } from '@/components/patterns/settings';
import { TextEntryFocusPreview } from './text-entry-focus-preview';
import { ModalHeadingPreview } from './modal-heading-preview';
import { SelectFocusPreview } from './select-catalog-preview';
import { Button } from '@/components/ui/button';
import { additionalPreviews } from './additional-catalog-previews';
import {
  collectGeometry,
  type GeometryProbeOptions,
  type GeometryProbeResult,
} from '../../../../src/lib/component-catalog/geometry-probe';

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Exact names and props from src/lib/components/ui/button/button.preview.svelte.
const buttonStates = {
  default: { children: 'Continue' },
  primary: { children: 'Continue', variant: 'primary' },
  secondary: { children: 'Continue', variant: 'secondary' },
  ghost: { children: 'Continue', variant: 'ghost' },
  outline: { children: 'Continue', variant: 'outline' },
  active: { active: true, children: 'Open menu', variant: 'outline' },
  'icon-weight': { children: 'Next', leadingIcon: <ArrowIcon />, variant: 'primary' },
  loading: { children: 'Saving', loading: true },
  disabled: { children: 'Unavailable', disabled: true },
  destructive: { children: 'Delete workspace', variant: 'destructive' },
} satisfies Record<string, ComponentProps<typeof Button>>;

interface PreviewDefinition {
  id: string;
  title: string;
  defaultState: string;
  source: string;
  states: Record<string, ReactNode>;
}
const previews: Record<string, PreviewDefinition> = {
  ...additionalPreviews,
  button: {
    id: 'button',
    title: 'Button',
    defaultState: 'default',
    source: 'src/lib/components/ui/button/button.preview.svelte',
    states: Object.fromEntries(
      Object.entries(buttonStates).map(([name, props]) => [name, <Button key={name} {...props} />]),
    ),
  },
  'settings-textarea': {
    id: 'settings-textarea',
    title: 'Settings textarea surfaces',
    defaultState: 'controls',
    source: 'src/lib/components/patterns/settings/settings-textarea.preview.svelte',
    states: { controls: <SettingsTextareaPreview /> },
  },
  'text-entry-focus': {
    id: 'text-entry-focus',
    title: 'Caret-only text entry focus',
    defaultState: 'default',
    source: 'src/lib/components/ui/text-entry-focus.preview.svelte',
    states: { default: <TextEntryFocusPreview /> },
  },
  'modal-heading-spacing': {
    id: 'modal-heading-spacing',
    title: 'Modal heading spacing',
    defaultState: 'form',
    source: 'src/lib/components/patterns/confirm/modal-heading-spacing.preview.svelte',
    states: {
      form: <ModalHeadingPreview kind="form" />,
      confirm: <ModalHeadingPreview kind="confirm" />,
      direct: <ModalHeadingPreview kind="direct" />,
      wrapped: <ModalHeadingPreview kind="wrapped" />,
      stacked: <ModalHeadingPreview kind="stacked" />,
    },
  },
  'select-focus': {
    id: 'select-focus',
    title: 'Select Escape focus restoration',
    defaultState: 'portalled',
    source: 'src/lib/components/ui/select/select-focus.preview.svelte',
    states: {
      inline: <SelectFocusPreview portal={false} />,
      portalled: <SelectFocusPreview portal />,
      static: <SelectFocusPreview staticPosition />,
    },
  },
};

export function getPreview(slug: string) {
  return previews[slug];
}
export function listPreviewIds() {
  return Object.keys(previews).sort();
}

export interface ActivePreview {
  slug: string;
  state: string;
  width: number;
  status: 'ready';
  fit?: 'component';
}
interface PreviewBrowserApi {
  list: () => string[];
  states: (slug: string) => Promise<string[]>;
  current: () => ActivePreview | null;
  probe: (
    options?: GeometryProbeOptions,
  ) => (GeometryProbeResult & Pick<ActivePreview, 'slug' | 'state' | 'width'>) | null;
}

let activePreview: ActivePreview | null = null;
export function setActivePreview(value: ActivePreview | null) {
  activePreview = value;
}

export function installPreviewBrowserApi(target: Window) {
  const previous = target.__INTENT_PREVIEW__;
  const api: PreviewBrowserApi = {
    list: listPreviewIds,
    states: async (slug) => Object.keys(getPreview(slug)?.states ?? {}),
    current: () => activePreview,
    probe: (options) => {
      if (!activePreview) return null;
      const root = target.document.querySelector<HTMLElement>(
        '[data-preview-ready="true"] [data-testid="catalog-scene-focus"]',
      );
      if (!root) return null;
      const { slug, state, width } = activePreview;
      return { slug, state, width, ...collectGeometry(root, options) };
    },
  };
  target.__INTENT_PREVIEW__ = api;
  return () => {
    if (target.__INTENT_PREVIEW__ === api) target.__INTENT_PREVIEW__ = previous;
  };
}

declare global {
  interface Window {
    __INTENT_PREVIEW__?: PreviewBrowserApi;
  }
}
