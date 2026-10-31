<script lang="ts">
  /**
   * "Initialize as git repository" toggle (Labs, plain-folder workspaces).
   * Shown on the New Workspace dialog and the onboarding project step, never
   * on the forge clone flows. Off creates a plain-folder workspace.
   */
  import { Switch } from '$lib/components/ui/switch';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
    class?: string;
  }

  let { checked, disabled = false, onCheckedChange, class: className = '' }: Props = $props();

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
      {m.workspace_plainFolder_initializeGit_label()}
    </label>
    <p id={`${id}-description`} class="text-xs text-muted-foreground">
      {m.workspace_plainFolder_initializeGit_description()}
    </p>
  </div>
</div>
