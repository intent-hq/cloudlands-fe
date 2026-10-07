<script lang="ts">
  import type { GitLabProjectPickerProps } from '../../gitlab-picker-types';
  interface Props {
    value?: string;
    displayValue?: string;
    emptyLabel?: string;
    triggerSuffix?: string;
    triggerValueClass?: string;
    triggerClass?: string;
    gitlab?: GitLabProjectPickerProps;
  }

  let {
    value = '',
    displayValue,
    emptyLabel = 'Select a repository',
    triggerSuffix,
    triggerValueClass = '',
    triggerClass = '',
    gitlab,
  }: Props = $props();
</script>

<button
  type="button"
  class={triggerClass}
  data-testid="repo-selector"
  data-trigger-class={triggerClass}
  data-trigger-suffix={triggerSuffix ?? ''}
  data-trigger-value-class={triggerValueClass}
>
  {value ? (displayValue ?? value) : emptyLabel}{#if triggerSuffix}
    ({triggerSuffix}){/if}
</button>

{#if gitlab?.onSelectRecent}
  <button
    type="button"
    data-testid="select-gitlab-recent"
    onclick={() => gitlab?.onSelectRecent?.('nested/team/target', gitlab.instanceBaseUrl!)}
  >
    Select saved GitLab repository
  </button>
  <button
    type="button"
    data-testid="select-wrong-root-recent"
    onclick={() =>
      gitlab?.onSelectRecent?.('nested/team/target', 'https://forge.example:8443/Other')}
  >
    Select repository from another installation
  </button>
{/if}
