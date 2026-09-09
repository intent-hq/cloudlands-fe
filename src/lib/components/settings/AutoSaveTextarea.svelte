<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import { AutoSaveField } from '$lib/components/patterns/form';
  import { Textarea } from '$lib/components/patterns/settings/custom-controls';

  interface Props {
    /** Current value (can be a computed/derived value) */
    value: string;
    /** Original value for change detection */
    originalValue?: string;
    placeholder?: string;
    minRows?: number;
    /** Maximum character limit (optional) */
    maxLength?: number;
    /** Called when value should be saved */
    onSave: (value: string) => void | Promise<void>;
    class?: string;
  }

  let {
    value,
    originalValue = '',
    placeholder = '',
    minRows = 8,
    maxLength,
    onSave,
    class: className = '',
  }: Props = $props();
</script>

<AutoSaveField
  {value}
  {originalValue}
  {onSave}
  prepare={(draft) => draft.trim()}
  canSave={(draft) => !maxLength || draft.length <= maxLength}
  class="h-full flex flex-col gap-2 {className}"
>
  {#snippet children(field)}
    {@const charCount = field.value.length}
    {@const warningThreshold = maxLength ? Math.floor(maxLength * 0.8) : 0}
    {@const isOverLimit = maxLength ? charCount > maxLength : false}
    {@const isApproachingLimit = maxLength ? charCount > warningThreshold && !isOverLimit : false}
    {@const charCountPercentage = maxLength
      ? Math.min(100, Math.round((charCount / maxLength) * 100))
      : 0}
    <div class="relative grow min-h-0 flex flex-col">
      <Textarea
        value={field.value}
        oninput={(event) => field.update(event.currentTarget.value)}
        onkeydown={field.onkeydown}
        onfocus={field.onfocus}
        onblur={field.onblur}
        {placeholder}
        rows={minRows}
        noFocusStyle
        class="grow {isOverLimit ? 'border-danger' : ''}"
      ></Textarea>
    </div>

    {#if maxLength && (isApproachingLimit || isOverLimit)}
      <div
        class="flex items-center justify-end text-xs shrink-0 {isOverLimit
          ? 'text-danger'
          : 'text-warning-ink'}"
      >
        <span>
          {m.settings_autoSave_limitUsed({
            percent: formatNumber(charCountPercentage / 100, {
              style: 'percent',
              maximumFractionDigits: 0,
            }),
          })}
        </span>
      </div>
    {/if}
  {/snippet}
</AutoSaveField>

<style>
  /* Textarea should fill its container and scroll internally, not expand */
  .grow :global(textarea) {
    height: 100%;
    resize: none;
    overflow-y: auto;
  }
</style>
