<script lang="ts">
  /**
   * The git choice (Labs, plain-folder workspaces), shown inside the folder
   * picker's "Existing folder" and "New" tabs of the New Workspace dialog and
   * the onboarding project step, never on the clone flows. Off creates a
   * plain-folder workspace. `kind` picks the copy: an existing folder is used
   * through an isolated copy, a new folder is initialized as a git repository.
   */
  import { Switch } from '$lib/components/ui/switch';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
    kind?: 'existing' | 'new';
    class?: string;
  }

  let {
    checked,
    disabled = false,
    onCheckedChange,
    kind = 'new',
    class: className = '',
  }: Props = $props();

  const label = $derived(
    kind === 'existing'
      ? m.workspace_plainFolder_isolatedCopy_label()
      : m.workspace_plainFolder_initializeGit_label(),
  );
  const description = $derived(
    kind === 'existing'
      ? m.workspace_plainFolder_isolatedCopy_description()
      : m.workspace_plainFolder_initializeGitChoice_description(),
  );

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
