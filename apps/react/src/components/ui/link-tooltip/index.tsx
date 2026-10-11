import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GitHubLinkCard } from '@/components/ui/github-link-card';
import { Portal } from '@/components/ui/portal';
import { formatUrlForDisplay } from '@/lib/links/format-url-for-display';
import { crispOut, springIn, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { selectLinkTooltip } from '@/store/link-tooltip/link-tooltip-selectors';
import type { LinkTooltipState } from '@/store/link-tooltip/link-tooltip-types';
import { isMacPlatform } from '$lib/utils/shortcuts';
import { m } from '$shared/paraglide/messages.js';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import {
  getLinkTooltipAnchor,
  hideLinkTooltip,
  releaseLinkTooltipAnchor,
} from './link-tooltip-anchor';
import './link-tooltip.css';

export { createLinkTooltipHandler, showLinkTooltip, hideLinkTooltip } from './link-tooltip-anchor';
export { formatUrlForDisplay } from '@/lib/links/format-url-for-display';

const VIEWPORT_MARGIN = 8;
const transition = (node: HTMLElement) => {
  const enter = springIn(node, { tier: 'fast', y: 4, scale: 0.96 });
  const exit = crispOut(node, { tier: 'fast' });
  return ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in' ? enter : exit;
};

/** Mount once. The application bootstrap, not this view, owns linkTooltipSaga. */
export function LinkTooltip() {
  const tooltip = selectLinkTooltip().value;
  const items = useMemo(() => (tooltip.visible ? [tooltip] : []), [tooltip]);
  const presence = usePresence(items, () => 'link-tooltip');
  const requestId = tooltip.request?.id;
  useEffect(() => {
    return () => {
      if (requestId !== undefined) releaseLinkTooltipAnchor(requestId);
    };
  }, [requestId]);
  useEffect(() => () => hideLinkTooltip(), []);

  return (
    <Portal zIndex={70}>
      {presence.entries.map(({ key, value, present }) => (
        <LinkTooltipSurface
          key={key}
          tooltip={value}
          present={present}
          onExit={() => presence.remove(key)}
        />
      ))}
    </Portal>
  );
}

function LinkTooltipSurface({
  tooltip,
  present,
  onExit,
}: {
  tooltip: LinkTooltipState;
  present: boolean;
  onExit: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ x: 0, top: 0, bottom: 0, measured: false });
  const [size, setSize] = useState({ width: 0, height: 0, viewportWidth: 0 });

  // The anchor is sampled when the delayed show takes effect, just like the source.
  useLayoutEffect(() => {
    const anchor =
      tooltip.shownRequestId === null ? undefined : getLinkTooltipAnchor(tooltip.shownRequestId);
    if (!anchor) return;
    if (!anchor.isConnected) {
      hideLinkTooltip(tooltip.shownRequestId ?? undefined);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    // oxlint-disable-next-line react/set-state-in-effect -- DOM-local geometry must be read after the delayed show.
    setGeometry({
      x: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
      measured: true,
    });
  }, [tooltip.shownRequestId]);

  useLayoutEffect(() => {
    const node = element.current;
    const view = node?.ownerDocument.defaultView;
    if (!node || !view) return;
    const measure = () => {
      const next = {
        width: node.offsetWidth,
        height: node.offsetHeight,
        viewportWidth: view.innerWidth,
      };
      setSize((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.viewportWidth === next.viewportWidth
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    view.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      view.removeEventListener('resize', measure);
    };
  }, []);

  usePresenceTransition(element, present, onExit, transition, geometry.measured);
  const below = geometry.top - VIEWPORT_MARGIN - size.height < VIEWPORT_MARGIN;
  const halfWidth = size.width / 2;
  const x = Math.max(
    VIEWPORT_MARGIN + halfWidth,
    Math.min(geometry.x, size.viewportWidth - VIEWPORT_MARGIN - halfWidth),
  );
  const y = below ? geometry.bottom + VIEWPORT_MARGIN : geometry.top - VIEWPORT_MARGIN;
  const modifierKey = isMacPlatform() ? '⌘' : 'Ctrl';
  const hint = tooltip.url.startsWith('mailto:')
    ? m.ui_linkTooltip_copyHint_tooltip({ key: modifierKey })
    : parseGitHubIssueOrPrUrl(tooltip.url)
      ? m.ui_linkTooltip_gitHubActionsHint_tooltip({ key: modifierKey })
      : m.ui_linkTooltip_inAppHint_tooltip({ key: modifierKey });
  const preview = tooltip.preview.status === 'idle' ? null : tooltip.preview;

  return (
    <div
      ref={element}
      className={cn('link-tooltip overlay-surface', {
        'link-tooltip--card': preview !== null,
        'link-tooltip--below': below,
      })}
      style={{ left: x, top: y, visibility: geometry.measured ? undefined : 'hidden' }}
      role="tooltip"
    >
      {preview ? (
        <GitHubLinkCard url={tooltip.url} preview={preview} />
      ) : (
        <div className="link-tooltip-url">{formatUrlForDisplay(tooltip.url)}</div>
      )}
      <div className="link-tooltip-hint">
        {tooltip.copied ? m.ui_linkTooltip_copied_label() : hint}
      </div>
    </div>
  );
}

export default LinkTooltip;
