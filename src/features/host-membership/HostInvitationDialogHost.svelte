<script lang="ts">
  import { onDestroy, type ComponentProps } from 'svelte';
  import HostInvitationDialog from './HostInvitationDialog.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { selectHostMembershipContext } from '$store/renderer/slices/host-membership/host-membership-selectors';
  import {
    selectInvitationAccountSearch,
    selectInvitationAccountResults,
    selectInvitationAccountSearchSupported,
  } from '$store/renderer/slices/invitation-account-search/invitation-account-search-selectors';
  import {
    accountSearchConfigured,
    accountSearchRequested,
    accountSearchClosed,
  } from '$store/renderer/slices/invitation-account-search/invitation-account-search-slice';

  const props: ComponentProps<typeof HostInvitationDialog> = $props();
  const session = $props.id();
  const context$ = selectHostMembershipContext();
  const supported$ = selectInvitationAccountSearchSupported();
  const search$ = selectInvitationAccountSearch();
  const users$ = selectInvitationAccountResults();
  // Bind the mounted dialog to its admitted lifetime. A same-owner rebind keeps
  // the presentational draft, while every old search generation is retired.
  $effect(() => {
    appStore.dispatch(
      accountSearchConfigured(
        session,
        props.busy || props.createdLink ? null : $context$,
        $supported$,
      ),
    );
  });
  onDestroy(() => appStore.dispatch(accountSearchClosed(session)));
  const current = $derived(
    $search$.session === session && $search$.context === $context$ && !props.busy,
  );
</script>

<HostInvitationDialog
  {...props}
  searchSupported={$supported$ && (!current || $search$.status !== 'unsupported')}
  searchEpoch={$context$}
  search={current
    ? { request: $search$.request, users: $users$, status: $search$.status, error: $search$.error }
    : undefined}
  onSearch={(request) => appStore.dispatch(accountSearchRequested(session, request))}
/>
