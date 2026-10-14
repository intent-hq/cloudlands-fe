import type { ComponentPropsWithoutRef } from 'react';
import { ActionRow } from '@/components/ui/menu';
import { GitHubAvatar } from '@/components/ui/github-avatar';
import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faGithub, faGitlab } from '$lib/icons/phosphor-icon-definitions';

type RepositoryPickerRowProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'children' | 'name' | 'title' | 'role'
> & {
  owner?: string;
  name: string;
  suffix?: string;
  provider?: 'github' | 'gitlab';
  avatarUrl?: string;
  showOwner?: boolean;
  showForge?: boolean;
  recent?: boolean;
  option?: boolean;
  selected?: boolean;
};

// i18n-ignore (brand names)
const forgeLabels = { github: 'GitHub', gitlab: 'GitLab' };

export function RepositoryPickerRow({
  owner,
  name,
  suffix,
  provider,
  avatarUrl,
  showOwner = true,
  showForge = false,
  recent = false,
  option = false,
  selected = false,
  className = '',
  ...button
}: RepositoryPickerRowProps) {
  return (
    <ActionRow
      {...button}
      role={option ? 'option' : undefined}
      selected={selected}
      className={`gap-2 py-1.5 cursor-pointer ${className}`}
      leading={
        avatarUrl ? (
          <PrincipalAvatar
            avatarUrl={avatarUrl}
            label={owner || name}
            size={16}
            referrerPolicy="no-referrer"
          />
        ) : owner && provider === 'github' ? (
          <GitHubAvatar
            identity={owner}
            className="size-4 rounded-full"
            fallback={<PrincipalAvatar label={owner} size={16} />}
          />
        ) : (
          <PrincipalAvatar label={owner || name} size={16} />
        )
      }
      title={
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate" data-recent-repo-label={recent ? '' : undefined}>
            {showOwner && owner && <span className="text-subtle mr-1">{owner} /</span>} {name}{' '}
            {suffix && <span className="text-subtle ml-1">({suffix})</span>}
          </span>
          {showForge && provider && (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source labeled image wrapper around its decorative inline SVG.
            <span role="img" aria-label={forgeLabels[provider]} className="text-subtle shrink-0">
              <IconDefinitionIcon icon={provider === 'github' ? faGithub : faGitlab} size={12} />
            </span>
          )}
        </span>
      }
    />
  );
}
