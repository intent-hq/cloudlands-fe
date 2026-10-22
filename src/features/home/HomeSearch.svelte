<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  let {
    value,
    onchange,
    placeholder,
    label = placeholder,
    class: className = '',
    inputClass = '',
  }: {
    value: string;
    onchange: (value: string) => void;
    placeholder: string;
    label?: string;
    class?: string;
    inputClass?: string;
  } = $props();
  let input: HTMLInputElement | undefined = $state();
  function clear() {
    onchange('');
    input?.focus();
  }
</script>

<div class="relative min-w-0 {className}">
  <Input
    bind:ref={input}
    type="search"
    {value}
    {placeholder}
    aria-label={label}
    class="pr-9 [&::-webkit-search-cancel-button]:appearance-none {inputClass}"
    oninput={(event) => onchange(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === 'Escape' && value) {
        event.preventDefault();
        clear();
      }
    }}
  />
  {#if value}
    <Button
      variant="ghost"
      size="icon-sm"
      class="absolute right-1 top-1/2 -translate-y-1/2"
      aria-label={m.chat_modelPicker_clearSearch_ariaLabel()}
      onclick={clear}
    >
      <Fa icon={faXmark} />
    </Button>
  {/if}
</div>
