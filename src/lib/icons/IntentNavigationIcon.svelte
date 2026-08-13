<script lang="ts" module>
  export const intentNavigationIconNames = ['spaces', 'tabs', 'settings', 'dandelion'] as const;

  export type IntentNavigationIconName = (typeof intentNavigationIconNames)[number];
</script>

<script lang="ts">
  interface Props {
    name: IntentNavigationIconName;
    size?: number | string;
    class?: string;
  }

  let { name, size = 16, class: className }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
  aria-hidden="true"
  focusable="false"
  data-navigation-icon={name}
>
  {#if name === 'spaces'}
    <rect
      x="1.75"
      y="3.75"
      width="2.5"
      height="8.5"
      rx="0.75"
      stroke="currentColor"
      stroke-width="1.5"
    />
    <rect
      x="6.75"
      y="3.75"
      width="2.5"
      height="8.5"
      rx="0.75"
      stroke="currentColor"
      stroke-width="1.5"
    />
    <rect
      x="11.75"
      y="3.75"
      width="2.5"
      height="8.5"
      rx="0.75"
      stroke="currentColor"
      stroke-width="1.5"
    />
  {:else if name === 'tabs'}
    <path
      d="M9.5 2.75H13.5C13.9142 2.75 14.25 3.08579 14.25 3.5V12.5C14.25 12.9142 13.9142 13.25 13.5 13.25H2.5C2.08579 13.25 1.75 12.9142 1.75 12.5V8.16699C1.75 7.75278 2.08579 7.41699 2.5 7.41699H8.75V3.5C8.75 3.08579 9.08579 2.75 9.5 2.75ZM2.5 2.75H5.5C5.91421 2.75 6.25 3.08579 6.25 3.5V4.16699C6.24982 4.58106 5.9141 4.91699 5.5 4.91699H2.5C2.08589 4.91699 1.75018 4.58106 1.75 4.16699V3.5C1.75 3.08579 2.08579 2.75 2.5 2.75Z"
      stroke="currentColor"
      stroke-width="1.5"
    />
  {:else if name === 'settings'}
    <path d="M9 5L14 5" stroke="currentColor" stroke-width="1.5" />
    <path d="M2 11H7" stroke="currentColor" stroke-width="1.5" />
    <circle cx="5" cy="5" r="2.25" stroke="currentColor" stroke-width="1.5" />
    <circle cx="11" cy="11" r="2.25" stroke="currentColor" stroke-width="1.5" />
  {:else}
    <path
      d="M10.4792 1.33398L9.23019 4.76581C9.07545 5.19082 9.2031 5.66727 9.54958 5.95802C9.89607 6.24878 10.3874 6.29173 10.7791 6.06563L13.9419 4.23958M14.7735 8.91547L11.1769 8.28131C10.7314 8.20278 10.2845 8.41116 10.0583 8.80291C9.83216 9.19467 9.87511 9.68598 10.1659 10.0325L12.5134 12.8301"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-miterlimit="10"
    />
    <path
      d="M5.52046 1.33398L6.76951 4.76581C6.92425 5.19082 6.7966 5.66727 6.45011 5.95802C6.10363 6.24878 5.61231 6.29173 5.22056 6.06563L2.0578 4.23958M1.22619 8.91547L4.82278 8.28131C5.26828 8.20278 5.71521 8.41116 5.94143 8.80291C6.16753 9.19467 6.12458 9.68598 5.83382 10.0325L3.48629 12.8301"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-miterlimit="10"
    />
    <path
      d="M7.99985 10.667L7.99985 15.3337"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-miterlimit="10"
    />
  {/if}
</svg>
