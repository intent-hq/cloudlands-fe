<script lang="ts">
  /**
   * The git switch (Labs, plain-folder workspaces), shown inside the folder
   * picker's "Existing folder" and "New" tabs of the New Workspace dialog and
   * the onboarding project step, never on the clone flows. Its label and hint
   * follow `folder`, the folder it acts on (see `gitSwitchCopy`).
   */
  import { Switch } from '$lib/components/ui/switch';
  import { gitSwitchCopy, type GitSwitchFolder } from './git-switch-copy';

  interface Props {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
    folder: GitSwitchFolder;
    class?: string;
  }

  let {
    checked,
    disabled = false,
    onCheckedChange,
    folder,
    class: className = '',
  }: Props = $props();

  const copy = $derived(gitSwitchCopy(folder));
  const label = $derived(copy.label);
  const description = $derived(copy.description);

  const id = `initialize-git-${crypto.randomUUID()}`;
</script>

<div class="flex min-w-0 items-start gap-2.5 {className}" data-testid="initialize-git-toggle">
  <Switch
    id={`${id}-switch`}
    {checked}
    {disabled}
    size="sm"
    class="mt-0.5 shrink-0"
    ariaLabelledby={`${id}-label`}
    ariaDescribedby={`${id}-description`}
    onCheckedChange={(value) => onCheckedChange(value)}
  />
  <div class="min-w-0">
    <label id={`${id}-label`} for={`${id}-switch`} class="text-sm font-medium text-foreground">
      {label}
    </label>
    <p id={`${id}-description`} class="text-xs text-muted-foreground">
      {description}
    </p>
  </div>
</div>
