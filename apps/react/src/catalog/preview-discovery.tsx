// Only executable React scenes are registered. Metadata is not proof of a port.
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
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

const previews = {
  button: {
    id: 'button',
    title: 'Button',
    defaultState: 'default',
    states: buttonStates,
    component: Button,
  },
};

export function getPreview(slug: string) {
  return slug === 'button' ? previews.button : undefined;
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
