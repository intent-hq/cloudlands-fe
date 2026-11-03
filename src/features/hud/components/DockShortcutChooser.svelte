<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import { selectDockShortcut } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { selectDockShortcutWorkspaces } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    dockShortcutChosen,
    dockShortcutChanged,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { dockLinkKey, type DockLinkScope } from '$shared/dock-shortcuts';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  const shortcut$ = selectDockShortcut();
  const workspaces$ = selectDockShortcutWorkspaces();
  let scope = $state<DockLinkScope | undefined>();
  const scopes: DockLinkScope[] = ['url', 'project', 'app'];
</script>

{#if $shortcut$}
  {@const shortcut = $shortcut$}
  {@const destination =
    $workspaces$.find((row) => row.id === shortcut.destination)?.title ?? m.dock_assistant_label()}
  <div class="flex min-h-0 flex-col gap-2 p-3 text-sm" data-testid="dock-shortcut-routing">
    {#if shortcut.destination}
      <div class="flex items-center justify-between gap-2">
        <span
          >{shortcut.context.action === 'record'
            ? m.dock_shortcut_record_destination({ workspace: destination })
            : m.dock_shortcut_focus_destination({ workspace: destination })}</span
        >
        <Button
          variant="ghost"
          size="sm"
          onclick={() => appStore.dispatch(dockShortcutChanged({ ...shortcut, destination: null }))}
          >{m.dock_shortcut_change()}</Button
        >
      </div>
    {:else}
      <strong
        >{shortcut.context.action === 'record'
          ? m.dock_shortcut_record_title()
          : m.dock_shortcut_focus_title()}</strong
      >
      <span class="text-muted-foreground"
        >{shortcut.context.appName ?? m.dock_shortcut_app_unknown()}{shortcut.context.title
          ? ` · ${shortcut.context.title}`
          : ''}</span
      >
      {#if shortcut.context.url}<span class="break-all text-muted-foreground"
          >{shortcut.context.url}</span
        >{/if}
      {#if shortcut.error}<span role="alert">{shortcut.error}</span>{/if}
      <div class="flex flex-wrap gap-1" aria-label={m.dock_shortcut_remember_aria()}>
        <Button
          variant={scope === undefined ? 'secondary' : 'ghost'}
          size="sm"
          onclick={() => (scope = undefined)}>{m.dock_shortcut_once()}</Button
        >
        {#each scopes as option}
          {#if dockLinkKey(shortcut.context, option) && (option !== 'app' || !shortcut.context.url)}
            <Button
              variant={scope === option ? 'secondary' : 'ghost'}
              aria-pressed={scope === option}
              title={dockLinkKey(shortcut.context, option) ?? undefined}
              size="sm"
              onclick={() => (scope = option)}
              >{option === 'url'
                ? m.dock_shortcut_page()
                : option === 'project'
                  ? m.dock_shortcut_project()
                  : m.dock_shortcut_app()}</Button
            >
          {/if}
        {/each}
      </div>
      <div
        class="flex max-h-56 flex-col gap-1 overflow-y-auto"
        aria-label={m.dock_shortcut_destination_aria()}
      >
        {#each $workspaces$ as workspace (workspace.id)}
          <Button
            variant="ghost"
            class="justify-start"
            onclick={() => appStore.dispatch(dockShortcutChosen(workspace.id, scope))}
            ><span class="truncate">{workspace.title} · {workspace.branch}</span></Button
          >
        {/each}
        <Button
          variant="ghost"
          class="justify-start"
          onclick={() => appStore.dispatch(dockShortcutChosen(CHIEF_WORKSPACE_ID))}
          >{m.dock_assistant_label()}</Button
        >
      </div>
      <Button variant="ghost" size="sm" onclick={() => appStore.dispatch(dockShortcutChanged(null))}
        >{m.chat_backgroundHooks_cancel_label()}</Button
      >
    {/if}
  </div>
{/if}
