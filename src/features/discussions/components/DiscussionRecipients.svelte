<script lang="ts">
  import { untrack } from 'svelte';
  import { Combobox } from '$lib/components/ui/combobox';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { DISCUSSION_MAX_RECIPIENTS } from '$shared/types/workspace-discussion';
  import { m } from '$shared/paraglide/messages.js';

  interface Member {
    principalId: string;
    displayName: string | null;
    login: string | null;
    avatarUrl: string | null;
  }
  let {
    members,
    selectedIds,
    onChange,
    loading = false,
    disabled = false,
    autofocus = false,
    onSearch,
    hasMore = false,
    onLoadMore,
  }: {
    members: readonly Member[];
    selectedIds: readonly string[];
    onChange: (ids: string[]) => void;
    loading?: boolean;
    disabled?: boolean;
    autofocus?: boolean;
    onSearch?: (query: string) => void;
    hasMore?: boolean;
    onLoadMore?: () => void;
  } = $props();
  let open = $state(false);
  $effect(() => {
    if (disabled) open = false;
  });
  let input: HTMLInputElement | null = $state(null);
  const name = (member: Member) =>
    member.displayName || member.login || m.workspace_discussion_unknownAuthor_label();
  const options = $derived(
    members
      .filter((member) => !selectedIds.includes(member.principalId))
      .map((member) => ({
        value: member.principalId,
        label: name(member),
        description: [member.login, member.principalId].filter(Boolean).join(' '),
        disabled: selectedIds.length >= DISCUSSION_MAX_RECIPIENTS,
      })),
  );
  $effect(() => {
    if (autofocus && !disabled && input) untrack(() => input?.focus({ preventScroll: true }));
  });
</script>

<div
  class="flex min-w-0 items-center gap-2 border-y border-border px-4 py-[9px]"
  data-discussion-recipients
>
  <span class="shrink-0 type-caption text-[12px] font-medium text-muted-foreground"
    >{m.workspace_discussion_to_label()}</span
  >
  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
    {#each selectedIds as id (id)}
      {@const member = members.find((member) => member.principalId === id)}
      {@const label = member ? name(member) : m.workspace_discussion_unknownAuthor_label()}
      <Badge
        color="gray"
        class="max-w-full rounded-full pl-[3px] pr-2"
        {...disabled
          ? { removable: false as const }
          : {
              removable: true as const,
              removeLabel: m.workspace_discussion_removeRecipient_label({ name: label }),
              onRemove: () => onChange(selectedIds.filter((selected) => selected !== id)),
            }}
      >
        {#snippet leadingIcon()}<PrincipalAvatar
            {label}
            avatarUrl={member?.avatarUrl}
            size={18}
          />{/snippet}
        <span class="block max-w-48 truncate">{label}</span>
      </Badge>
    {/each}
    <Combobox
      bind:open
      bind:inputRef={input}
      multiple
      value={[...selectedIds]}
      {options}
      {loading}
      {disabled}
      displayValue=""
      ariaLabel={m.workspace_discussion_recipients_label()}
      placeholder={selectedIds.length
        ? m.workspace_discussion_addRecipient_placeholder()
        : m.workspace_discussion_chooseRecipients_placeholder()}
      searchPlaceholder={selectedIds.length
        ? m.workspace_discussion_addRecipient_placeholder()
        : m.workspace_discussion_chooseRecipients_placeholder()}
      emptyText={m.workspace_discussion_noMembers_label()}
      class={selectedIds.length ? 'w-28 max-w-full' : 'w-56 max-w-full'}
      inputClass="h-6 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:outline-none"
      contentClass="w-72"
      onchange={(value) => onChange(Array.isArray(value) ? value : [])}
      oncommit={() => (open = false)}
      onquerychange={onSearch}
      footer={hasMore ? moreMembers : undefined}
    >
      {#snippet optionDescription(option)}
        {@const login = members.find((member) => member.principalId === option.value)?.login}
        {#if login && login.toLowerCase() !== option.label.replace(/^@/, '').toLowerCase()}<span
            class="type-caption max-w-1/2 shrink-0 truncate text-muted-foreground">@{login}</span
          >{/if}
      {/snippet}
    </Combobox>
  </div>
</div>

{#snippet moreMembers()}
  <Button variant="ghost" size="sm" {loading} onclick={onLoadMore}
    >{m.workspace_discussion_loadMoreMembers_label()}</Button
  >
{/snippet}
