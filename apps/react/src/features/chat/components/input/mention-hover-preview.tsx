// Source: src/lib/components/chat/input/MentionHoverPreview.svelte.
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import {
  BookIcon,
  CheckSquareIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  NoteIcon,
  RobotIcon,
  TerminalIcon,
  UserIcon,
  type Icon,
} from '@phosphor-icons/react';
import { crispOut, springIn, usePresenceTransition } from '@/lib/motion';
import type { MentionCandidate, MentionType } from '$lib/services/mentions/types';
import { memberMentionLabel, memberMentionSubtitle } from '$lib/utils/member-mention-token';
import { m } from '$shared/paraglide/messages.js';
import './mention-hover-preview.css';

export interface MentionHoverPreviewProps {
  mention: MentionCandidate;
  position: { x: number; y: number };
  onClose?: () => void;
  /** Retain the mounted preview through its outro using the shared presence adapter. */
  present?: boolean;
  onExit?: () => void;
}

const typeIcons: Partial<Record<MentionType, Icon>> = {
  file: FileIcon,
  'file-range': FileIcon,
  folder: FolderIcon,
  'source-folder': FolderIcon,
  note: NoteIcon,
  'note-range': NoteIcon,
  task: CheckSquareIcon,
  rule: BookIcon,
  command: TerminalIcon,
  'external-source': GlobeIcon,
  agent: RobotIcon,
  member: UserIcon,
  personality: UserIcon,
  workspace: FolderIcon,
  symbol: FileIcon,
};

const previewTransition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in'
      ? springIn(node, { tier: 'fast', y: 0, scale: 1 })
      : crispOut(node, { tier: 'fast' });
const noExit = () => {};

export function MentionHoverPreview({
  mention,
  position,
  onClose,
  present = true,
  onExit = noExit,
}: MentionHoverPreviewProps) {
  const hoverElement = useRef<HTMLDivElement>(null);
  // The reference captures path and coordinates at mount, rather than tracking props or resize.
  const [initialPosition] = useState(position);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [displayPath] = useState(() => {
    if (mention.type === 'member') return memberMentionSubtitle(mention);
    const meta = mention.meta as (MentionCandidate['meta'] & { relativePath?: string }) | undefined;
    return meta?.relativePath || meta?.fullPath || meta?.path || '';
  });
  useLayoutEffect(() => {
    let { x, y } = initialPosition;
    if (x + 250 > window.innerWidth) x = window.innerWidth - 250 - 10;
    if (y + 30 > window.innerHeight) y = initialPosition.y - 30 - 10;
    // oxlint-disable-next-line react/set-state-in-effect -- Measure the client viewport after SSR/hydration, before paint.
    setAdjustedPosition({ x, y });
  }, [initialPosition]);
  usePresenceTransition(hoverElement, present, onExit, previewTransition);
  const TypeIcon = typeIcons[mention.type] ?? FileIcon;

  function handleMouseOut(event: MouseEvent<HTMLDivElement>) {
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Element) || !relatedTarget.closest('[data-mention]'))
      onClose?.();
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- This non-focusable tooltip preserves the source mouse lifetime; its caller owns keyboard dismissal.
    <div
      ref={hoverElement}
      className="mention-hover-preview"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      role="tooltip"
      aria-label={m.chat_mentionPreview_ariaLabel()}
      // oxlint-disable-next-line jsx-a11y/mouse-events-have-key-events -- The source preview is pointer-owned and has no focusable content.
      onMouseOut={handleMouseOut}
    >
      <div className="preview-content">
        <div className="preview-icon">
          <TypeIcon size="1em" aria-hidden="true" />
        </div>
        <div className="preview-text">
          <span className="filename">
            {mention.type === 'member' ? memberMentionLabel(mention.label) : mention.label}
          </span>
          {displayPath && <span className="path">{displayPath}</span>}
        </div>
      </div>
    </div>
  );
}
