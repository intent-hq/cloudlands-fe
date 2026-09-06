import { createRawSnippet, type ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import Button from './button.svelte';

function label(text: string) {
  return createRawSnippet(() => ({ render: () => text }));
}

const arrowIcon = createRawSnippet(() => ({
  render: () =>
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>',
}));

export const preview = definePreview<ComponentProps<typeof Button>>({
  id: 'button',
  title: 'Button',
  defaultState: 'default',
  states: {
    default: { props: { children: label('Continue') } },
    primary: { props: { children: label('Continue'), variant: 'primary' } },
    secondary: { props: { children: label('Continue'), variant: 'secondary' } },
    ghost: { props: { children: label('Continue'), variant: 'ghost' } },
    outline: { props: { children: label('Continue'), variant: 'outline' } },
    active: { props: { active: true, children: label('Open menu'), variant: 'outline' } },
    'icon-weight': {
      props: { children: label('Next'), leadingIcon: arrowIcon, variant: 'primary' },
    },
    loading: { props: { children: label('Saving'), loading: true } },
    disabled: { props: { children: label('Unavailable'), disabled: true } },
    destructive: {
      props: { children: label('Delete workspace'), variant: 'destructive' },
    },
  },
});

export default Button;
