import { GithubLogoIcon, GitlabLogoIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import {
  presencePersonColor,
  presencePersonLabel,
  presencePersonName,
  presencePersonRing,
  type PresenceCircle,
  type PresenceCircleAction,
  type PresenceRing,
} from '../../../../../../src/features/presence/components/presence-person';

export interface PresenceAvatarStackProps {
  people: PresenceCircle[];
  maxVisible?: number;
  /** Avatar diameter in CSS px. */
  size?: number;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Skip the per-avatar tooltips when the parent already names the people. */
  decorative?: boolean;
  action?: (person: PresenceCircle) => PresenceCircleAction;
  class?: string;
  className?: string;
}

const RING_CLASS: Record<PresenceRing, string> = {
  owner: 'ring-2 ring-info',
  member: 'ring-2 ring-success',
  guest: 'ring-2 ring-warning-ink',
  offline: 'ring-2 ring-muted-foreground/40',
};

function PresenceAvatar({ person, size }: { person: PresenceCircle; size: number }) {
  const ring = presencePersonRing(person);
  const offline = person.online === false;
  const fontSize = Math.max(8, Math.round(size * 0.55));
  const badgeSize = Math.max(9, Math.round(size * 0.5));
  const ForgeIcon = person.identity?.provider === 'gitlab' ? GitlabLogoIcon : GithubLogoIcon;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 rounded-full border border-background',
        ring && RING_CLASS[ring],
      )}
      style={{ width: size, height: size }}
      data-presence-avatar={person.principalId}
      data-presence-ring={ring ?? undefined}
      data-presence-offline={offline || undefined}
      data-presence-self={person.self || undefined}
    >
      <span
        className={cn(
          'inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full font-medium leading-none text-primary-foreground',
          offline && 'grayscale',
        )}
        style={{ fontSize, backgroundColor: presencePersonColor(person.principalId) }}
        data-presence-avatar-tile=""
      >
        <PrincipalAvatar fill avatarUrl={person.avatarUrl} label={presencePersonName(person)} />
      </span>
      {person.hostRole && person.online !== undefined && (
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-background',
            person.online ? 'bg-success' : 'bg-muted-foreground',
          )}
          aria-hidden="true"
          data-presence-status={person.online ? 'online' : 'offline'}
        />
      )}
      {person.identity && (
        <span
          className="absolute -right-0.5 -bottom-0.5 inline-flex items-center justify-center rounded-full bg-background text-foreground"
          style={{ width: badgeSize, height: badgeSize, fontSize: Math.round(badgeSize * 0.8) }}
          aria-hidden="true"
          data-presence-identity-provider={person.identity.provider}
          data-presence-identity-host={person.identity.host}
        >
          <ForgeIcon
            size="1em"
            weight="bold"
            data-icon={person.identity.provider}
            data-weight="bold"
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}

/** Presentational source port; the caller owns presence and action resolution. */
export function PresenceAvatarStack({
  people,
  maxVisible = 3,
  size = 16,
  side = 'bottom',
  decorative = false,
  action,
  class: sourceClass,
  className,
}: PresenceAvatarStackProps) {
  if (people.length === 0) return null;

  const visible = people.slice(0, maxVisible);
  const overflow = Math.max(0, people.length - maxVisible);
  const onlineOthers = people.filter((person) => !person.self && person.online !== false).length;
  const offlineOthers = people.filter((person) => !person.self && person.online === false).length;
  const label =
    onlineOthers === 1
      ? m.presence_avatarStack_people_one()
      : onlineOthers > 1
        ? m.presence_avatarStack_people_many({ count: formatInteger(onlineOthers) })
        : offlineOthers === 0
          ? m.presence_avatarStack_onlyYou_label()
          : offlineOthers === 1
            ? m.presence_avatarStack_offline_one()
            : m.presence_avatarStack_offline_many({ count: formatInteger(offlineOthers) });

  return (
    <span
      className={cn('inline-flex items-center -space-x-1', sourceClass, className)}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source inline avatar group without native fieldset layout.
      role="group"
      aria-label={label}
      data-presence-avatar-stack=""
      data-presence-count={people.length}
    >
      {visible.map((person) => {
        if (action) {
          const { label: personLabel, onSelect } = action(person);
          return (
            <Button
              key={person.principalId}
              variant="plain"
              wrapContent={false}
              className="h-auto rounded-full p-0 aria-disabled:opacity-100"
              tooltip={personLabel}
              tooltipSide={side}
              aria-label={personLabel}
              aria-disabled={onSelect ? undefined : true}
              ref={(element) => {
                if (!element || !onSelect) return;
                // Keep the source's native MouseEvent and button currentTarget,
                // including preventDefault/stopPropagation and keyboard clicks.
                const target: HTMLElement = element;
                target.addEventListener('click', onSelect);
                return () => target.removeEventListener('click', onSelect);
              }}
              data-presence-person-button={person.principalId}
            >
              <PresenceAvatar person={person} size={size} />
            </Button>
          );
        }
        if (decorative) {
          return <PresenceAvatar key={person.principalId} person={person} size={size} />;
        }
        const personLabel = presencePersonLabel(person);
        return (
          <Tooltip key={person.principalId} content={personLabel} side={side}>
            <PresenceAvatar person={person} size={size} />
            <span className="sr-only">{personLabel}</span>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-background bg-muted px-1 font-medium leading-none text-muted-foreground"
          style={{ minWidth: size, height: size, fontSize: Math.max(8, Math.round(size * 0.55)) }}
          data-presence-overflow={overflow}
        >
          {m.presence_avatarStack_more_label({ count: formatInteger(overflow) })}
        </span>
      )}
    </span>
  );
}
