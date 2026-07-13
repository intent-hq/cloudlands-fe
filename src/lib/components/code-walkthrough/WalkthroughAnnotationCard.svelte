<script lang="ts">
  /**
   * WalkthroughAnnotationCard
   *
   * Displays an inline annotation within the diff viewer.
   * Shows a message explaining a specific line or range of lines.
   */
  import Fa from 'svelte-fa';
  import {
  faLightbulb,
  faInfoCircle,
  faQuestionCircle,
  faExclamationTriangle,
  faStar,
} from '@fortawesome/free-solid-svg-icons';
  import type { AnnotationCategory, AnnotationImportance } from './types';

  interface Props {
    message: string;
    category: AnnotationCategory;
    importance: AnnotationImportance;
    lineNumber?: number;
    endLine?: number;
    class?: string;
  }

  let {
    message,
    category,
    importance,
    lineNumber,
    endLine,
    class: className = '',
  }: Props = $props();

  // Category-based styling
  const categoryConfig = $derived.by(() => {
    switch (category) {
      case 'explanation':
        return {
          icon: faLightbulb,
          bgColor: 'bg-blue-50 dark:bg-blue-950/30',
          borderColor: 'border-blue-200 dark:border-blue-800',
          iconColor: 'text-blue-500',
        };
      case 'context':
        return {
          icon: faInfoCircle,
          bgColor: 'bg-slate-50 dark:bg-slate-900/30',
          borderColor: 'border-slate-200 dark:border-slate-700',
          iconColor: 'text-slate-500',
        };
      case 'rationale':
        return {
          icon: faQuestionCircle,
          bgColor: 'bg-purple-50 dark:bg-purple-950/30',
          borderColor: 'border-purple-200 dark:border-purple-800',
          iconColor: 'text-purple-500',
        };
      case 'warning':
        return {
          icon: faExclamationTriangle,
          bgColor: 'bg-amber-50 dark:bg-amber-950/30',
          borderColor: 'border-amber-200 dark:border-amber-800',
          iconColor: 'text-amber-500',
        };
      case 'highlight':
        return {
          icon: faStar,
          bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
          borderColor: 'border-emerald-200 dark:border-emerald-800',
          iconColor: 'text-emerald-500',
        };
      default:
        return {
          icon: faInfoCircle,
          bgColor: 'bg-slate-50 dark:bg-slate-900/30',
          borderColor: 'border-slate-200 dark:border-slate-700',
          iconColor: 'text-slate-500',
        };
    }
  });

  // Importance affects visual weight
  const importanceStyles = $derived.by(() => {
    switch (importance) {
      case 'high':
        return 'font-medium';
      case 'low':
        return 'text-subtle';
      default:
        return '';
    }
  });

  // Line range display
  const lineLabel = $derived.by(() => {
    if (!lineNumber) return null;
    if (endLine && endLine > lineNumber) {
      return `Lines ${lineNumber}-${endLine}`;
    }
    return `Line ${lineNumber}`;
  });
</script>

<div
  class="walkthrough-annotation rounded-md border px-3 py-2 my-1 {categoryConfig.bgColor} {categoryConfig.borderColor} {className}"
>
  <div class="flex items-start gap-2">
    <Fa icon={categoryConfig.icon} class="h-3.5 w-3.5 mt-0.5 shrink-0 {categoryConfig.iconColor}" />
    <div class="flex-1 min-w-0">
      <p class="text-sm leading-relaxed {importanceStyles}">{message}</p>
      {#if lineLabel}
        <span class="text-xs text-subtle mt-1 block">{lineLabel}</span>
      {/if}
    </div>
  </div>
</div>
