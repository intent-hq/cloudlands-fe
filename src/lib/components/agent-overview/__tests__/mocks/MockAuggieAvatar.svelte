<script lang="ts">
  interface Props {
    agentId?: string;
    seed?: string;
    [key: string]: unknown;
  }

  let { agentId = '', seed = '', ...rest }: Props = $props();
  const legacyThinkingProp = 'is' + 'Thinking';
  const legacyColorProp = 'color' + 'Seed';
  const legacyFaceProp = 'face' + 'Seed';
</script>

<div
  data-testid="mock-auggie-avatar"
  data-agent-id={agentId}
  data-seed={seed}
  data-has-legacy-thinking-prop={String(legacyThinkingProp in rest)}
  data-has-legacy-color-seed-prop={String(legacyColorProp in rest)}
  data-has-legacy-face-seed-prop={String(legacyFaceProp in rest)}
></div>