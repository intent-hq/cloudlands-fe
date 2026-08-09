<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import type { GithubLinkDefaultAction } from '$shared/utils/link-helpers';
  import { selectGithubLinkDefaultAction } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setGithubLinkDefaultAction } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const defaultAction = selectGithubLinkDefaultAction();
  const options: { value: GithubLinkDefaultAction; label: string }[] = [
    { value: 'show-choices', label: m.settings_githubLinks_showChoices_option() },
    { value: 'open-in-browser', label: m.settings_githubLinks_openInBrowser_option() },
    { value: 'open-in-app', label: m.settings_githubLinks_openInApp_option() },
    { value: 'copy-link', label: m.settings_githubLinks_copyLink_option() },
    { value: 'start-workspace', label: m.settings_githubLinks_startWorkspace_option() },
  ];
  const selectedLabel = $derived(
    options.find((option) => option.value === $defaultAction)?.label ??
      m.settings_githubLinks_showChoices_option(),
  );

  function handleChange(value: string) {
    appStore.dispatch(setGithubLinkDefaultAction(value as GithubLinkDefaultAction));
  }
</script>

<div class="flex items-center justify-between gap-6">
  <div>
    <p class="text-sm font-medium text-foreground">
      {m.settings_githubLinks_defaultAction_label()}
    </p>
    <p class="text-xs text-subtle mt-0.5">
      {m.settings_githubLinks_defaultAction_description()}
    </p>
  </div>
  <div class="w-[180px] flex-shrink-0">
    <Select.Root value={$defaultAction} onchange={handleChange}>
      <Select.Trigger><span class="truncate">{selectedLabel}</span></Select.Trigger>
      <Select.Content portal class="w-[180px]">
        {#each options as option (option.value)}
          <Select.Item value={option.value}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
</div>
