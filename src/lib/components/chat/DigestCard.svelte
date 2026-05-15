<script lang="ts">

interface Props {
    digest: string;
  }

  let { digest }: Props = $props();
</script>

<div
  class="digest-card flex items-start gap-2.5 py-5 px-6 my-4 shadow-xs text-base leading-normal border border-border"
>
  {digest}
</div>
