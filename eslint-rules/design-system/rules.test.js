import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import { designSystemRules } from './index.js';
import iconOnlyButtonSize from './icon-only-button-size.js';
import noAdhocTransitions from './no-adhoc-transitions.js';
import noArbitraryMotionOrColor from './no-arbitrary-motion-or-color.js';
import noButtonCompatibilityAliases from './no-button-compatibility-aliases.js';
import noDialogRootOutsidePatterns from './no-dialog-root-outside-patterns.js';
import noDirectToast from './no-direct-toast.js';
import noLegacySpinner from './no-legacy-spinner.js';
import noNativeDialogs from './no-native-dialogs.js';
import noRawControls from './no-raw-controls.js';
import noRawMenuRow from './no-raw-menu-row.js';
import settingsUseSchema from './settings-use-schema.js';

const projectFile = (file) => path.resolve(file);
const scriptTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const svelteTester = new RuleTester({
  languageOptions: {
    parser: svelteParser,
    parserOptions: { parser: typescriptParser, ecmaVersion: 2022, sourceType: 'module' },
  },
});

describe('design-system rule guidance', () => {
  it('names a replacement and catalog URL in every message', () => {
    for (const rule of Object.values(designSystemRules)) {
      for (const message of Object.values(rule.meta.messages)) {
        expect(message).toMatch(/^Use `.+` instead — \/sandbox\/(?:[a-z-]+|\{\{slug\}\})$/);
      }
    }
  });
});

svelteTester.run('no-raw-controls', noRawControls, {
  valid: [
    {
      code: '<button>Primitive host</button>',
      filename: projectFile('src/lib/components/ui/button/button.svelte'),
    },
    {
      code: '<button>Sidebar primitive host</button>',
      filename: projectFile('src/lib/components/ui/sidebar/sidebar-menu-button.svelte'),
    },
  ],
  invalid: [
    {
      code: '<button>Save</button><input />',
      filename: projectFile('src/features/example/Editor.svelte'),
      errors: [
        { message: 'Use `Button` instead — /sandbox/button' },
        { message: 'Use `Input` instead — /sandbox/input' },
      ],
    },
    {
      code: '<input type="file" />',
      filename: projectFile('src/features/onboarding/steps/OnboardingPromptStep.svelte'),
      errors: [{ message: 'Use `Input` instead — /sandbox/input' }],
    },
    {
      code: '<button>Consumer action</button>',
      filename: projectFile('src/lib/components/ui/sidebar/sidebar-group-action.svelte'),
      errors: [{ message: 'Use `Button` instead — /sandbox/button' }],
    },
  ],
});

svelteTester.run('no-raw-menu-row', noRawMenuRow, {
  valid: [
    {
      code: '<Button role="menuitem" class={cn(menuItem(), "text-danger")} />',
      filename: projectFile('src/features/example/ActionMenu.svelte'),
    },
    {
      code: '<span role="option" class="px-3" />',
      filename: projectFile('src/features/example/Status.svelte'),
    },
  ],
  invalid: [
    {
      code: '<Button role="menuitem" class="px-3">Action</Button>',
      filename: projectFile('src/features/example/ActionMenu.svelte'),
      errors: [{ messageId: 'rawMenuRow' }],
    },
    {
      code: '<button role="menuitemradio" class="px-3">Choice</button><div role="menuitemcheckbox" class="px-3">Toggle</div><div role="option" class="px-3">Option</div>',
      filename: projectFile('src/features/example/ActionMenu.svelte'),
      errors: [
        { messageId: 'rawMenuRow' },
        { messageId: 'rawMenuRow' },
        { messageId: 'rawMenuRow' },
      ],
    },
  ],
});

svelteTester.run('no-button-compatibility-aliases', noButtonCompatibilityAliases, {
  valid: [
    '<script>import { Button } from "$lib/components/ui/button";</script><Button variant="primary" size="sm">Save</Button>',
    '<script>import { Button } from "$lib/components/ui/button";</script><Button variant={variant} size={size}>Save</Button>',
    '<Button variant="default" size="xs">Unrelated component</Button>',
    '<Badge variant="default" size="xs">Status</Badge>',
  ],
  invalid: [
    {
      code: '<script>import { Button } from "$lib/components/ui/button";</script><Button variant="default" size="xs">Save</Button>',
      errors: [
        { message: 'Use `variant="secondary"` instead — /sandbox/button' },
        { message: 'Use `size="compact"` instead — /sandbox/button' },
      ],
    },
    {
      code: '<script>import PrimaryButton from "$lib/components/ui/button/button.svelte";</script><PrimaryButton variant="tertiary" size="icon-xs" aria-label="More" />',
      errors: [
        { message: 'Use `variant="outline"` instead — /sandbox/button' },
        { message: 'Use `size="icon-compact"` instead — /sandbox/button' },
      ],
    },
    {
      code: '<script>import { Button as ActionButton } from "$lib/components/ui/button";</script><ActionButton variant="neumorphic">Save</ActionButton>',
      errors: [{ message: 'Use `variant="outline"` instead — /sandbox/button' }],
    },
    {
      code: '<script>import { Button } from "$lib/components/ui/button/index.js";</script><Button variant="default">Save</Button>',
      errors: [{ message: 'Use `variant="secondary"` instead — /sandbox/button' }],
    },
  ],
});

const buttonImport = 'import { Button } from "$lib/components/ui/button";';
const faImport = 'import Fa from "svelte-fa";';
const withScript = (...imports) => `<script>${imports.join('')}</script>`;
const iconButton = withScript(buttonImport, faImport);
const settingsIconButton = withScript(
  'import { Button, Input } from "$lib/components/patterns/settings/custom-controls";',
  faImport,
);
const phosphorImport = 'import { ChatTextIcon } from "phosphor-svelte";';
const phosphorDeepImport = 'import XIcon from "phosphor-svelte/lib/XIcon";';
const iconSizeError = {
  message:
    'Use `size="icon"` or another icon size such as `size="icon-compact"` instead — /sandbox/button',
};
const buttonSizeKeys = (() => {
  const source = readFileSync(
    projectFile('src/lib/components/ui/button/button.variants.ts'),
    'utf8',
  );
  const block = source.match(/\n {4}size: \{\n([\s\S]*?)\n {4}\},\n/)[1];
  return [...block.matchAll(/^\s*'?([a-z-]+)'?:/gm)].map(([, key]) => key);
})();

svelteTester.run('icon-only-button-size', iconOnlyButtonSize, {
  valid: [
    `${iconButton}<Button size="icon-compact" aria-label="More"><Fa icon={faEllipsis} /></Button>`,
    `${settingsIconButton}<Button size="icon-compact" aria-label="More"><Fa icon={faEllipsis} /></Button>`,
    `${iconButton}<Button size={size} aria-label="More"><Fa icon={faEllipsis} /></Button>`,
    `${withScript(buttonImport, phosphorImport)}<Button size="icon-compact" aria-label="Chat"><ChatTextIcon /></Button>`,
    `${withScript(buttonImport, phosphorDeepImport)}<Button size="icon-compact" aria-label="Close"><XIcon /></Button>`,
    `${iconButton}<Button size="sm"><Fa icon={faPlus} /> Add</Button>`,
    `${iconButton}<Button size="sm">{label}<Fa icon={faPlus} /></Button>`,
    `${iconButton}<Button size="sm"><Fa icon={faPlus} />{@render children()}</Button>`,
    `${iconButton}<Button size="sm">{#snippet leadingIcon()}<Fa icon={faPlus} />{/snippet}</Button>`,
    `${withScript(buttonImport)}<Button size="sm" aria-label="Save" />`,
    `${withScript(buttonImport)}<Button iconOnly={false} size="sm">Save</Button>`,
    `${withScript(buttonImport)}<Button iconOnly={dynamic} size="sm">Save</Button>`,
    `${iconButton}<Button size="sm">{#if busy}<Fa icon={faSpinner} />{:else}Save{/if}</Button>`,
    `${withScript(buttonImport, 'import Badge from "$lib/components/ui/badge/badge.svelte";')}<Button size="sm"><Badge /></Button>`,
    `${withScript(faImport)}<Button aria-label="More"><Fa icon={faEllipsis} /></Button>`,
    `${withScript('import { Toggle } from "$lib/components/ui/toggle";', faImport)}<Toggle aria-label="More"><Fa icon={faEllipsis} /></Toggle>`,
    ...buttonSizeKeys
      .filter((key) => key.startsWith('icon'))
      .map((key) => `${iconButton}<Button size="${key}"><Fa icon={faX} /></Button>`),
    {
      code: `${iconButton}<Button aria-label="More"><Fa icon={faEllipsis} /></Button><Button aria-label="Close"><Fa icon={faX} /></Button>`,
      filename: projectFile('src/features/legacy/Toolbar.svelte'),
      options: [{ baseline: { 'src/features/legacy/Toolbar.svelte': 2 } }],
    },
  ],
  invalid: [
    {
      code: `${iconButton}<Button aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport)}<Button aria-label="More"><svg viewBox="0 0 16 16" /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport, phosphorImport)}<Button aria-label="Chat"><ChatTextIcon /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport, phosphorDeepImport)}<Button aria-label="Close"><XIcon /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport)}<Button iconOnly size="sm" aria-label="Save">Save</Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport)}<Button iconOnly aria-label="Save" />`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button iconOnly={true} aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript(buttonImport)}<Button iconOnly={true} size="sm" aria-label="Save">Save</Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button iconOnly={false} aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button size="" aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button size aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${settingsIconButton}<Button aria-label="More"><Fa icon={faEllipsis} /></Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button size="sm">{#if busy}<Fa icon={faSpinner} />{:else if done}<svg />{:else}<Fa icon={faPlus} />{/if}</Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button size="sm">{#if busy}<Fa icon={faSpinner} />{/if}</Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<!-- more --><Button aria-label="More">\n  <!-- icon -->\n  <Fa icon={faEllipsis} />\n</Button>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript('import { Button as ActionButton } from "$lib/components/ui/button";', faImport)}<ActionButton aria-label="More"><Fa icon={faEllipsis} /></ActionButton>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript('import IconButton from "$lib/components/ui/button/button.svelte";', 'import KebabIcon from "$lib/components/icons/KebabIcon.svelte";')}<IconButton size="compact" aria-label="More"><KebabIcon /></IconButton>`,
      errors: [iconSizeError],
    },
    {
      code: `${withScript('import { Button } from "$lib/components/ui/button/index.js";', 'import KebabIcon from "../icons/KebabIcon.svelte";')}<Button aria-label="More"><KebabIcon /></Button>`,
      filename: projectFile('src/lib/components/toolbar/Toolbar.svelte'),
      errors: [iconSizeError],
    },
    {
      code: `${iconButton}<Button aria-label="More"><Fa icon={faEllipsis} /></Button><Button aria-label="Close"><Fa icon={faX} /></Button>`,
      filename: projectFile('src/features/legacy/Toolbar.svelte'),
      options: [{ baseline: { 'src/features/legacy/Toolbar.svelte': 1 } }],
      errors: [iconSizeError],
    },
    ...buttonSizeKeys
      .filter((key) => !key.startsWith('icon'))
      .map((key) => ({
        code: `${iconButton}<Button size="${key}"><Fa icon={faX} /></Button>`,
        errors: [iconSizeError],
      })),
  ],
});

describe('icon-only-button-size drift guard', () => {
  it('reads the size ladder from button.variants.ts', () => {
    expect(buttonSizeKeys).toContain('icon');
    expect(buttonSizeKeys).toContain('default');
  });
});

svelteTester.run('no-legacy-spinner', noLegacySpinner, {
  valid: [
    {
      code: '<script>import { IntentMarkLoader } from "$lib/components/ui/indicators";</script><IntentMarkLoader size={16} />',
      filename: projectFile('src/features/example/LoadingView.svelte'),
    },
    {
      code: '<script>import { faSpinner } from "icons"; import SpinnerIcon from "./SpinnerIcon.svelte";</script><SpinnerIcon /><div class:animate-spin={loading} />',
      filename: projectFile('src/lib/components/ui/indicators/LegacyPreview.svelte'),
    },
    {
      code: 'import { faSpinner } from "icons";',
      filename: projectFile('src/features/example/loading.ts'),
    },
  ],
  invalid: [
    {
      code: '<script>import { faSpinner as loadingIcon } from "icons";</script>',
      filename: projectFile('src/features/example/LoadingView.svelte'),
      errors: [{ messageId: 'legacyIcon' }],
    },
    {
      code: '<script>import LegacyLoader from "$lib/SpinnerIcon.svelte";</script><LegacyLoader />',
      filename: projectFile('src/features/example/LoadingView.svelte'),
      errors: [{ messageId: 'legacyComponent' }, { messageId: 'legacyComponent' }],
    },
    {
      code: '<SpinnerIcon /><div class="motion-safe:animate-spin" /><span class:animate-spin={loading} />',
      filename: projectFile('src/routes/example/+page.svelte'),
      errors: [
        { messageId: 'legacyComponent' },
        { messageId: 'spinClass' },
        { messageId: 'spinClass' },
      ],
    },
    {
      code: '<script>const classes = loading ? `size-4 animate-spin` : "";</script>',
      filename: projectFile('src/features/example/LoadingView.svelte'),
      errors: [{ messageId: 'spinClass' }],
    },
  ],
});

scriptTester.run('no-direct-toast', noDirectToast, {
  valid: [
    {
      code: "import { toast } from 'svelte-sonner';",
      filename: projectFile('src/lib/components/patterns/notify/notify.ts'),
    },
  ],
  invalid: [
    {
      code: "import { toast } from 'svelte-sonner';",
      filename: projectFile('src/features/example/toast.ts'),
      errors: [{ messageId: 'directToast' }],
    },
    {
      code: "import('svelte-sonner');",
      filename: projectFile('src/features/example/lazy-toast.ts'),
      errors: [{ messageId: 'directToast' }],
    },
  ],
});

scriptTester.run('no-native-dialogs', noNativeDialogs, {
  valid: [
    'import { confirm } from "$lib/components/patterns/confirm"; confirm({ title: "Continue?" });',
    'function ask(confirm) { confirm("Continue?"); }',
    'const alert = () => {}; alert("Local");',
    'function prompt() {} prompt();',
    'function ask(window, globalThis, self) { window.confirm(); globalThis.prompt(); self.alert(); }',
    'other.confirm(); window[method]();',
  ],
  invalid: [
    ...[
      'alert("x")',
      'confirm()',
      'prompt()',
      'globalThis.prompt()',
      'self.alert()',
      'window["confirm"]()',
      'globalThis?.alert?.()',
    ].map((code) => ({
      code,
      errors: [{ messageId: 'nativeDialog' }],
    })),
    {
      code: 'alert("x")',
      languageOptions: { globals: { alert: 'readonly' } },
      errors: [{ messageId: 'nativeDialog' }],
    },
    {
      code: 'window.confirm("Continue?"); window.alert("Stopped"); window.prompt("Name");',
      errors: [
        { messageId: 'nativeDialog' },
        { messageId: 'nativeDialog' },
        { messageId: 'nativeDialog' },
      ],
    },
  ],
});

scriptTester.run('no-adhoc-transitions', noAdhocTransitions, {
  valid: [
    {
      code: "import { spring } from 'svelte/motion';",
      filename: projectFile('src/lib/motion/springs.ts'),
    },
    {
      code: "export { fade } from 'svelte/transition';",
      filename: projectFile('src/lib/motion/transitions.ts'),
    },
  ],
  invalid: [
    {
      code: "import { fade } from 'svelte/transition';",
      filename: projectFile('src/features/example/view.ts'),
      errors: [{ messageId: 'adhocTransition' }],
    },
    {
      code: "import('svelte/motion');",
      filename: projectFile('src/features/example/lazy-view.ts'),
      errors: [{ messageId: 'adhocTransition' }],
    },
    {
      code: "export { fade } from 'svelte/transition';",
      filename: projectFile('src/features/example/reexport.ts'),
      errors: [{ messageId: 'adhocTransition' }],
    },
  ],
});

svelteTester.run('no-arbitrary-motion-or-color', noArbitraryMotionOrColor, {
  valid: [
    '<div class="duration-spring-fast ease-[var(--spring-fast-ease)] bg-card text-foreground" />',
    '<div class="duration-spring-slow ease-spring-slow motion-reduce:transition-none" />',
    '<div class="duration-spring-moderate-exit ease-spring-exit" />',
    '<div class="hover:duration-spring-fast group-hover:ease-spring-fast motion-safe:duration-spring-slow-exit" />',
    '<div class="border-border ring-ring outline-muted fill-current stroke-foreground divide-border accent-primary caret-foreground" />',
    '<div class="border-[var(--border)] ring-[var(--ring)] fill-[var(--foreground)]" style="color: hsl(var(--foreground)); border-color: var(--border)" />',
    '<style>.tokenized { color: hsl(var(--foreground)); background: var(--card); }</style>',
    '<div style="background-image: url(#abc)" /><style>#abc { color: var(--foreground); }</style>',
    '<div style="transition: all 0.2s ease-out" /><circle style="transition: r 0.3s ease-out" />',
    '<div style:transition="all 0.2s ease-out" style:animation-timing-function="ease-in" />',
    '<div style:color="hsl(var(--foreground))" style:transition={`opacity 0.2s ${easing}`} />',
    '<div class="duration-spring-fast! hover:ease-spring-fast! !duration-spring-slow-exit" />',
    {
      code: '<div class="border-red-500" style="color: #abc" />',
      filename: projectFile('src/features/brand/Mark.svelte'),
      options: [
        {
          allowlist: [
            {
              name: 'brand-mark',
              files: ['src/features/brand/Mark.svelte'],
              colors: ['#abc'],
              utilities: ['border-red-500'],
            },
          ],
        },
      ],
    },
    {
      code: '<div class="border-red-500 text-blue-500" />',
      filename: projectFile('src/features/legacy/Panel.svelte'),
      options: [{ baseline: { 'src/features/legacy/Panel.svelte': 2 } }],
    },
  ],
  invalid: [
    {
      code: '<div class="duration-[120ms] bg-[#123456]" />',
      errors: [{ messageId: 'arbitraryMotion' }, { messageId: 'arbitraryColor' }],
    },
    {
      code: '<script>const classes = `ease-[linear] text-[#fff]`;</script>',
      errors: [{ messageId: 'arbitraryMotion' }, { messageId: 'arbitraryColor' }],
    },
    {
      code: '<div class="duration-300 ease-out" />',
      errors: [{ messageId: 'arbitraryMotion' }, { messageId: 'arbitraryMotion' }],
    },
    {
      code: '<div class="hover:duration-150 motion-safe:group-hover:ease-in-out" />',
      errors: [{ messageId: 'arbitraryMotion' }, { messageId: 'arbitraryMotion' }],
    },
    {
      code: '<div class="ease-out" style="transition: all 0.2s ease-out" />',
      errors: [{ messageId: 'arbitraryMotion' }],
    },
    {
      code: '<div class="ease-out" style:transition="all 0.2s ease-out" />',
      errors: [{ messageId: 'arbitraryMotion' }],
    },
    {
      code: '<div class="duration-300! ease-out! duration-[120ms]!" />',
      errors: Array.from({ length: 3 }, () => ({ messageId: 'arbitraryMotion' })),
    },
    {
      code: '<div class="!duration-300 hover:duration-300! md:!ease-out motion-safe:group-hover:ease-in-out!" />',
      errors: Array.from({ length: 4 }, () => ({ messageId: 'arbitraryMotion' })),
    },
    {
      code: '<div class="duration-initial ease-linear ease-in ease-initial" />',
      errors: Array.from({ length: 4 }, () => ({ messageId: 'arbitraryMotion' })),
    },
    {
      code: '<script>const classes = `transition-opacity duration-75 ${open ? "ease-out" : "ease-in"}`;</script>',
      errors: Array.from({ length: 3 }, () => ({ messageId: 'arbitraryMotion' })),
    },
    {
      code: '<div class="border-red-500 ring-blue-400 outline-amber-600 fill-green-500 stroke-purple-300 divide-gray-200 accent-pink-500 caret-orange-700" />',
      errors: Array.from({ length: 8 }, () => ({ messageId: 'physicalPalette' })),
    },
    {
      code: '<div class="border-[#abc] ring-[rgb(1_2_3)] outline-[hsl(1_2%_3%)] fill-[#abcdef] stroke-[rgba(1,2,3,0.5)] divide-[#abcd] accent-[hsl(1,2%,3%)] caret-[#abcdef12]" />',
      errors: Array.from({ length: 8 }, () => ({ messageId: 'arbitraryColor' })),
    },
    {
      code: '<svg fill="#abc" stroke="rgb(1 2 3)"></svg><div style="color: #abcdef; border-color: hsl(10 20% 30%)" /><style>.sample { fill: #1234; stroke: rgba(1, 2, 3, 0.5); }</style>',
      errors: [
        { messageId: 'svgColor' },
        { messageId: 'svgColor' },
        { messageId: 'cssColor' },
        { messageId: 'cssColor' },
        { messageId: 'cssColor' },
        { messageId: 'cssColor' },
      ],
    },
    {
      code: '<div class="border-red-500 text-blue-500 fill-green-500" />',
      filename: projectFile('src/features/legacy/Panel.svelte'),
      options: [{ baseline: { 'src/features/legacy/Panel.svelte': 2 } }],
      errors: [{ messageId: 'physicalPalette' }],
    },
    {
      code: '<div class="border-red-500 duration-300" />',
      filename: projectFile('src/features/legacy/Panel.svelte'),
      options: [{ baseline: { 'src/features/legacy/Panel.svelte': 1 } }],
      errors: [{ messageId: 'arbitraryMotion' }],
    },
    {
      code: '<div class="duration-300 border-red-500 text-blue-500" style="color: #abc" />',
      filename: projectFile('src/features/legacy/Panel.svelte'),
      options: [{ baseline: { 'src/features/legacy/Panel.svelte': 2 } }],
      errors: [{ messageId: 'arbitraryMotion' }, { messageId: 'cssColor' }],
    },
  ],
});

svelteTester.run('no-dialog-root-outside-patterns', noDialogRootOutsidePatterns, {
  valid: [
    ...['false', 'null', "'false'"].map((expression) => ({
      code: `<div role="dialog" aria-modal={${expression}} />`,
      filename: projectFile('src/lib/components/modals/NonModal.svelte'),
    })),
    {
      code: '<div role="alertdialog" aria-modal="true" />',
      filename: projectFile('src/lib/components/modals/InviteProgressModal.svelte'),
    },
    {
      code: '<div role="dialog" aria-modal={embedded ? undefined : true} />',
      filename: projectFile('src/features/onboarding/messages/DirectoryPickerView.svelte'),
    },
    {
      code: '<Dialog.Root />',
      filename: projectFile('src/lib/components/patterns/confirm/FormDialog.svelte'),
    },
  ],
  invalid: [
    ...['true', 'embedded ? undefined : true', 'modal'].map((expression) => ({
      code: `<div role="dialog" aria-modal={${expression}} />`,
      filename: projectFile('src/lib/components/modals/RawModal.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    })),
    {
      code: '<div role="dialog" aria-modal="true" />',
      filename: projectFile('src/lib/components/modals/RawModal.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    },
    {
      code: '<script>import { Dialog as Primitive } from "bits-ui";</script><Primitive.Root />',
      filename: projectFile('src/features/example/RawModal.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    },
    {
      code: '<script>import * as Modal from "$lib/components/ui/dialog";</script><Modal.Root />',
      filename: projectFile('src/lib/components/modals/NewFeature.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    },
    {
      code: '<script>import { Root as Modal } from "$lib/components/ui/dialog";</script><Modal />',
      filename: projectFile('src/routes/example/+page.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    },
    {
      code: '<Dialog.Root />',
      filename: projectFile('src/features/example/ConfirmView.svelte'),
      errors: [{ messageId: 'dialogRoot' }],
    },
  ],
});

svelteTester.run('settings-use-schema', settingsUseSchema, {
  valid: [
    {
      code: '<script>import { defineSettings } from "$lib/components/patterns/settings";</script>',
      filename: projectFile('src/lib/components/settings/Example.svelte'),
    },
  ],
  invalid: [
    {
      code: '<script>import Button from "../ui/button/button.svelte";</script>',
      filename: projectFile('src/lib/components/settings/Example.svelte'),
      errors: [{ messageId: 'directPrimitive' }],
    },
  ],
});
