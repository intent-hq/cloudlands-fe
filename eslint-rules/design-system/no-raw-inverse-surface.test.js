// @vitest-environment node
import { RuleTester } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import typescriptParser from '@typescript-eslint/parser';
import rule from './no-raw-inverse-surface.js';

const raw = [{ messageId: 'rawInverseSurface' }];
const mixed = [{ messageId: 'mixedInverseText' }];
const repainted = [{ messageId: 'repaintedTooltip' }];
const tooltipImport = `<script lang="ts">
  import { Tooltip, TooltipShortcut } from '$lib/components/ui/tooltip';
</script>`;
const namespaceImport = `<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
</script>`;

new RuleTester({
  languageOptions: {
    parser: svelteParser,
    parserOptions: { parser: typescriptParser, ecmaVersion: 2022, sourceType: 'module' },
  },
}).run('no-raw-inverse-surface Svelte', rule, {
  valid: [
    '<div class="surface-inverse px-2">Label</div>',
    '<span class="size-2 rounded-full bg-foreground"></span>',
    '<span class="bg-primary text-background">On a fill</span>',
    '<span class="text-foreground/60">Dimmed</span>',
    '<p title="bg-foreground text-background">Not a class</p>',
    `${tooltipImport}<Tooltip contentClass="flex items-center gap-3 p-1.5">x</Tooltip>`,
    `${tooltipImport}<Tooltip variant="secondary" contentClass="bg-secondary! p-0">x</Tooltip>`,
    `${namespaceImport}<Tooltip.Content class="max-w-sm">x</Tooltip.Content>`,
    `<script lang="ts">
  import { Tooltip } from 'bits-ui';
</script><Tooltip.Content class="bg-popover">x</Tooltip.Content>`,
    `<script lang="ts">
  import { TooltipRich } from '$lib/components/ui/tooltip';
</script><TooltipRich contentClass="bg-transparent!">x</TooltipRich>`,
  ],
  invalid: [
    { code: '<div class="bg-foreground px-2 text-background">x</div>', errors: raw },
    { code: '<div class="rounded-full bg-foreground! text-background!">x</div>', errors: raw },
    { code: '<div class="hover:bg-foreground hover:text-background">x</div>', errors: raw },
    {
      code: `<script lang="ts">
  const row = cn('px-3', { 'bg-foreground text-background pl-2.5': committed });
</script>`,
      errors: raw,
    },
    { code: '<span class="text-background/60">owner</span>', errors: mixed },
    { code: '<span class="group-hover/row:text-background/60">open</span>', errors: mixed },
    {
      code: '<span class={on ? "text-background/50" : "text-muted-foreground"}>x</span>',
      errors: mixed,
    },
    {
      code: `${tooltipImport}<Tooltip contentClass="bg-secondary! p-0 text-secondary-foreground!">x</Tooltip>`,
      errors: repainted,
    },
    {
      code: `${tooltipImport}<Tooltip variant="default" contentClass="bg-muted">x</Tooltip>`,
      errors: repainted,
    },
    {
      code: `${tooltipImport}<TooltipShortcut label="Find" contentClass="bg-popover">x</TooltipShortcut>`,
      errors: repainted,
    },
    {
      code: `${namespaceImport}<Tooltip.Content class="bg-popover text-popover-foreground">x</Tooltip.Content>`,
      errors: repainted,
    },
  ],
});

new RuleTester({ languageOptions: { parser: typescriptParser } }).run(
  'no-raw-inverse-surface TS',
  rule,
  {
    valid: [
      "const dot = 'bg-foreground dark:bg-accent';",
      "const scope = 'surface-inverse rounded-full';",
    ],
    invalid: [
      { code: "const surface = 'bg-foreground text-background';", errors: raw },
      { code: "const hint = 'text-background/70';", errors: mixed },
    ],
  },
);
