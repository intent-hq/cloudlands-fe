import path from 'node:path';
import { RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import { designSystemRules } from './index.js';
import noAdhocTransitions from './no-adhoc-transitions.js';
import noArbitraryMotionOrColor from './no-arbitrary-motion-or-color.js';
import noButtonCompatibilityAliases from './no-button-compatibility-aliases.js';
import noDialogRootOutsidePatterns from './no-dialog-root-outside-patterns.js';
import noDirectToast from './no-direct-toast.js';
import noLegacySpinner from './no-legacy-spinner.js';
import noNativeDialogs from './no-native-dialogs.js';
import noRawControls from './no-raw-controls.js';
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
      code: '<input type="file" />',
      filename: projectFile('src/features/onboarding/steps/OnboardingPromptStep.svelte'),
    },
    {
      code: '<button>Primitive host</button>',
      filename: projectFile('src/lib/components/ui/button/button.svelte'),
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
        { message: 'Use `variant="primary"` instead — /sandbox/button' },
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
      errors: [{ message: 'Use `variant="primary"` instead — /sandbox/button' }],
    },
  ],
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
  valid: ['confirm({ title: "Continue?" });'],
  invalid: [
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
    '<div class="border-border ring-ring outline-muted fill-current stroke-foreground divide-border accent-primary caret-foreground" />',
    '<div class="border-[var(--border)] ring-[var(--ring)] fill-[var(--foreground)]" style="color: hsl(var(--foreground)); border-color: var(--border)" />',
    '<style>.tokenized { color: hsl(var(--foreground)); background: var(--card); }</style>',
    '<div style="background-image: url(#abc)" /><style>#abc { color: var(--foreground); }</style>',
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
  ],
});

svelteTester.run('no-dialog-root-outside-patterns', noDialogRootOutsidePatterns, {
  valid: [
    {
      code: '<Dialog.Root />',
      filename: projectFile('src/lib/components/patterns/confirm/FormDialog.svelte'),
    },
  ],
  invalid: [
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
