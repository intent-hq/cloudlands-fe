import type { LinkTooltipPreview } from '@/lib/links/link-tooltip-types';

export interface LinkTooltipRequest {
  id: number;
  url: string;
  workspaceId?: string;
}

/** One transient hover; DOM elements, observers and resource handles never enter Redux. */
export interface LinkTooltipState {
  request: LinkTooltipRequest | null;
  visible: boolean;
  shownRequestId: number | null;
  url: string;
  copied: boolean;
  preview: LinkTooltipPreview;
}
