/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source editor-owned listbox, button options, and block status surfaces. */
// Source: src/lib/components/chat/input/EnhancedMentionList.svelte.
import {
  Fragment,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BookOpenIcon,
  BrainIcon,
  BugIcon,
  CaretRightIcon,
  ChalkboardTeacherIcon,
  ChartLineUpIcon,
  CheckSquareIcon,
  CopyIcon,
  CubeIcon,
  DatabaseIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FlaskIcon,
  FolderIcon,
  FolderOpenIcon,
  GearIcon,
  GitBranchIcon,
  GlobeIcon,
  HammerIcon,
  ImageIcon,
  LightbulbIcon,
  LightningIcon,
  ListChecksIcon,
  LockIcon,
  MagicWandIcon,
  NoteIcon,
  PackageIcon,
  PaletteIcon,
  PenNibIcon,
  PlayIcon,
  RobotIcon,
  RocketIcon,
  ShieldIcon,
  StudentIcon,
  TerminalIcon,
  TextAlignLeftIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  isMentionGroup,
  type MentionCandidate,
  type MentionGroup,
} from '$lib/services/mentions/types';
import { getIconForType, type IconName } from '$lib/services/mentions/icon-map';
import { memberMentionLabel } from '$lib/utils/member-mention-token';
import { m } from '$shared/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { menuItem } from '@/components/ui/menu/menu-recipes';
import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import { cn } from '@/lib/utils';
import { MentionAgentAvatar } from './mention-agent-avatar';
import { useMentionBreadcrumbs } from './use-mention-breadcrumbs';
import './enhanced-mention-list.css';

export interface EnhancedMentionListHandle {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean;
}

export interface EnhancedMentionListProps {
  items: (MentionCandidate | MentionGroup)[];
  command: (item: MentionCandidate) => void;
  onClose?: () => void;
  loading?: boolean;
  listboxId?: string;
  onActiveOptionChange?: (id: string | undefined) => void;
  ref?: Ref<EnhancedMentionListHandle>;
}

// Exact source getIcon mappings, resolved through phosphor-icons.ts/FaWrapper.
// FaWrapper resolves faNote by iconName to NoteIcon, not its legacy SVG path.
const icons: Partial<Record<IconName | 'chevron-right' | 'brain', Icon>> = {
  file: FileIcon,
  'file-code': FileCodeIcon,
  'file-text': FileTextIcon,
  'file-json': FileCodeIcon,
  folder: FolderIcon,
  'folder-open': FolderOpenIcon,
  'folder-code': FolderIcon,
  'sticky-note': NoteIcon,
  'list-todo': ListChecksIcon,
  'check-square': CheckSquareIcon,
  shield: ShieldIcon,
  terminal: TerminalIcon,
  'external-link': ArrowSquareOutIcon,
  globe: GlobeIcon,
  palette: PaletteIcon,
  database: DatabaseIcon,
  settings: GearIcon,
  lock: LockIcon,
  'git-branch': GitBranchIcon,
  box: PackageIcon,
  wrench: WrenchIcon,
  package: CubeIcon,
  image: ImageIcon,
  'test-tube': FlaskIcon,
  'book-open': BookOpenIcon,
  'package-check': CheckSquareIcon,
  users: UsersIcon,
  lightbulb: LightbulbIcon,
  'pen-tool': PenNibIcon,
  bug: BugIcon,
  sparkles: MagicWandIcon,
  'trending-up': ChartLineUpIcon,
  'refresh-cw': ArrowsClockwiseIcon,
  'shield-check': ShieldIcon,
  'align-left': TextAlignLeftIcon,
  'shield-alert': ShieldIcon,
  play: PlayIcon,
  hammer: HammerIcon,
  rocket: RocketIcon,
  github: GitBranchIcon,
  gitlab: GitBranchIcon,
  files: CopyIcon,
  folders: FolderIcon,
  'chevron-right': CaretRightIcon,
  'user-tie': UserIcon,
  'user-graduate': StudentIcon,
  'chalkboard-teacher': ChalkboardTeacherIcon,
  bolt: LightningIcon,
  robot: RobotIcon,
  brain: BrainIcon,
};

const emptyItems: (MentionCandidate | MentionGroup)[] = [];

function getIcon(item: MentionCandidate | MentionGroup): Icon {
  const type = isMentionGroup(item) ? 'group' : item.type;
  const { subtype } = item as (MentionCandidate | MentionGroup) & { subtype?: string };
  const name = getIconForType(type, subtype);
  return icons[name] ?? FileIcon;
}

function groupItems(items: (MentionCandidate | MentionGroup)[]) {
  const grouped = new Map<string, (MentionCandidate | MentionGroup)[]>();
  for (const item of Array.isArray(items) ? items : []) {
    // These are internal grouping keys, never labels rendered by the component.
    const key = isMentionGroup(item) ? 'Groups' : item.group || 'Other';
    const group = grouped.get(key) || [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
}

export function EnhancedMentionList({
  items = emptyItems,
  command,
  onClose,
  loading = false,
  listboxId,
  onActiveOptionChange,
  ref,
}: EnhancedMentionListProps) {
  const componentId = useId();
  const { controller, state } = useMentionBreadcrumbs();
  // Explicit .value read is tracked by the app's Signals Babel transform.
  const navigation = state.value;
  const breadcrumbs = navigation.breadcrumbs;
  const currentItems = breadcrumbs.length > 0 ? navigation.currentItems : items;
  const listElement = useRef<HTMLDivElement>(null);
  const scrollRequested = useRef(false);
  const [selection, setSelection] = useState({
    items: currentItems,
    index: 0,
    ignoreMouseUntilMove: true,
  });
  let selectedIndex = selection.index;
  let ignoreMouseUntilMove = selection.ignoreMouseUntilMove;
  if (selection.items !== currentItems) {
    selectedIndex = 0;
    ignoreMouseUntilMove = true;
    setSelection({ items: currentItems, index: 0, ignoreMouseUntilMove: true });
  }
  const groupedItems = groupItems(currentItems);
  const visualOrderItems = Array.from(groupedItems.values()).flat();
  const selectedItem = visualOrderItems[selectedIndex] ?? currentItems[selectedIndex] ?? null;

  function optionId(item: MentionCandidate | MentionGroup) {
    return `${componentId}-option-${encodeURIComponent(`${isMentionGroup(item) ? 'group' : item.type}:${item.id}`)}`;
  }
  const activeOptionId = selectedItem ? optionId(selectedItem) : undefined;
  useEffect(() => {
    onActiveOptionChange?.(activeOptionId);
  }, [onActiveOptionChange, activeOptionId]);

  useLayoutEffect(() => {
    if (!scrollRequested.current) return;
    scrollRequested.current = false;
    listElement.current
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [selection]);

  function moveSelection(delta: number) {
    const length = visualOrderItems.length;
    if (length === 0) return;
    scrollRequested.current = true;
    setSelection((current) => ({
      ...current,
      index: (current.index + delta + length) % length,
    }));
  }

  function selectItem(index: number) {
    const item = visualOrderItems[index];
    if (!item) return;
    if (isMentionGroup(item)) {
      controller.push(item);
      setSelection((current) => ({ ...current, index: 0 }));
    } else {
      command(item);
    }
  }

  function navigateToBreadcrumb(index: number) {
    controller.navigateToBreadcrumb(index);
    setSelection((current) => ({ ...current, index: 0 }));
  }

  function handleKeyDown(event: KeyboardEvent | ReactKeyboardEvent<HTMLDivElement>): boolean {
    if (controller.handleKeyboard(event)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        moveSelection(event.key === 'ArrowUp' ? -1 : 1);
        return true;
      case 'ArrowRight':
        if (!selectedItem || !isMentionGroup(selectedItem)) return false;
        event.preventDefault();
        event.stopPropagation();
        selectItem(selectedIndex);
        return true;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        selectItem(selectedIndex);
        return true;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (breadcrumbs.length > 0) controller.navigateToRoot();
        else onClose?.();
        return true;
      default:
        return false;
    }
  }

  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => handleKeyDown(event) }));

  return (
    <div className="enhanced-mention-list" ref={listElement}>
      <div className="mention-container">
        <div className="mention-list-section">
          {breadcrumbs.length > 0 && (
            <div className="breadcrumbs">
              <Button
                variant="plain"
                className="breadcrumb-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => controller.navigateToRoot()}
              >
                {m.chat_mentionList_all_label()}
              </Button>
              {breadcrumbs.map((crumb, index) => (
                <Fragment key={crumb.id || `crumb-${index}`}>
                  <span className="breadcrumb-separator">›</span>
                  <Button
                    variant="plain"
                    className="breadcrumb-item"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => navigateToBreadcrumb(index)}
                  >
                    {crumb.icon && <span className="breadcrumb-icon">{crumb.icon}</span>}
                    {crumb.label}
                  </Button>
                </Fragment>
              ))}
            </div>
          )}
          {loading && currentItems.length === 0 ? (
            <div
              className="mention-loading"
              role="status"
              aria-label={m.ui_combobox_loadingOptions_message()}
            >
              {[0, 1, 2, 3].map((index) => (
                <div className="mention-skeleton" key={index}>
                  <div className="skeleton-icon" />
                  <div className="skeleton-text" style={{ width: `${55 + index * 12}%` }} />
                </div>
              ))}
            </div>
          ) : currentItems.length > 0 ? (
            <div
              className="mention-items"
              id={listboxId ?? `${componentId}-listbox`}
              role="listbox"
              tabIndex={-1}
              aria-label={m.chat_mentionList_ariaLabel()}
              aria-activedescendant={activeOptionId}
              aria-busy={loading}
              onKeyDown={handleKeyDown}
              onMouseMove={() =>
                setSelection((current) =>
                  current.ignoreMouseUntilMove
                    ? { ...current, ignoreMouseUntilMove: false }
                    : current,
                )
              }
            >
              {Array.from(groupedItems.entries()).map(([groupName, group]) => (
                <Fragment key={groupName}>
                  {group.map((item) => {
                    const visualIndex = visualOrderItems.indexOf(item);
                    const ItemIcon = getIcon(item);
                    const isSelected = visualIndex === selectedIndex;
                    const candidate = isMentionGroup(item) ? undefined : item;
                    const isMember = candidate?.type === 'member';
                    const label = isMember ? memberMentionLabel(item.label) : item.label;
                    return (
                      <Button
                        key={optionId(item)}
                        variant="plain"
                        wrapContent={false}
                        className={cn(menuItem(), 'mention-item', isSelected && 'selected')}
                        id={optionId(item)}
                        role="option"
                        aria-selected={isSelected}
                        aria-label={
                          isMember && candidate.subtitle
                            ? `${label} · ${candidate.subtitle}`
                            : label
                        }
                        tabIndex={-1}
                        onPointerDown={(event) => event.preventDefault()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectItem(visualIndex)}
                        onMouseEnter={() => {
                          if (!ignoreMouseUntilMove)
                            setSelection((current) => ({ ...current, index: visualIndex }));
                        }}
                      >
                        {isMember ? (
                          <PrincipalAvatar
                            avatarUrl={candidate.meta?.avatarUrl}
                            label={item.label}
                            size={18}
                          />
                        ) : candidate?.type === 'agent' ? (
                          <span className="mention-agent-avatar">
                            <MentionAgentAvatar agentId={item.id} />
                          </span>
                        ) : (
                          <span className={cn('mention-icon', isSelected && 'selected')}>
                            <ItemIcon size="1em" weight="regular" aria-hidden="true" />
                          </span>
                        )}
                        <div className="mention-content">
                          <div className="mention-label-line">
                            <span className="mention-label">{label}</span>
                            {(candidate?.type === 'agent' || candidate?.type === 'specialist') &&
                              candidate.group && (
                                <span className="mention-kind">{candidate.group}</span>
                              )}
                          </div>
                          {candidate?.subtitle && (
                            <span className="mention-subtitle">{candidate.subtitle}</span>
                          )}
                        </div>
                        {isMentionGroup(item) && (
                          <span className="group-arrow">
                            <CaretRightIcon size="0.75em" weight="regular" aria-hidden="true" />
                          </span>
                        )}
                      </Button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="mention-empty" role="status">
              {m.chat_mentionList_noResults_label()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
