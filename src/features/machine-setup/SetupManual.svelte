<script lang="ts">
  /**
   * Run it myself: the install command for the other computer (macOS and
   * Linux, or Windows), then the field for the intent:// link it prints. The
   * wizard submits the field through the nodes paste flow.
   */
  import { CopyInput, ToggleGroup } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineSetupTarget } from '$shared/types/machine-setup';
  import PairLinkField from '$features/nodes/PairLinkField.svelte';
  import { unixInstallCommand, windowsInstallCommand } from './install-lines';

  interface Props {
    target: MachineSetupTarget;
    text?: string;
  }

  let { target, text = $bindable('') }: Props = $props();

  let system = $state<'unix' | 'windows'>('unix');
  const command = $derived(
    system === 'windows' ? windowsInstallCommand(target) : unixInstallCommand(target),
  );
  const uid = $props.id();
</script>

<div class="space-y-5" data-machine-setup-manual={target}>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <p id="{uid}-command" class="type-body text-foreground">
        {m.machineSetup_manual_command_label()}
      </p>
      <ToggleGroup.Root
        type="single"
        bind:value={system}
        size="sm"
        variant="flat"
        aria-label={m.machineSetup_manual_system_ariaLabel()}
      >
        <ToggleGroup.Item value="unix">{m.machineSetup_manual_unix_label()}</ToggleGroup.Item>
        <ToggleGroup.Item value="windows">{m.machineSetup_manual_windows_label()}</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
    <CopyInput
      value={command}
      aria-labelledby="{uid}-command"
      class="font-mono"
      data-machine-setup-command={system}
    />
    <p class="type-caption text-muted-foreground">
      {target === 'node'
        ? m.machineSetup_manual_nodeEnds_description()
        : m.machineSetup_manual_backendEnds_description()}
    </p>
  </div>
  <div class="space-y-2">
    <p class="type-body text-foreground">{m.machineSetup_manual_paste_label()}</p>
    <PairLinkField bind:text hint={m.machineSetup_manual_paste_description()} />
  </div>
</div>
