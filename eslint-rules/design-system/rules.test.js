import path from 'node:path';
import { RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import { designSystemRules } from './index.js';
import noAdhocTransitions from './no-adhoc-transitions.js';
import noArbitraryMotionOrColor from './no-arbitrary-motion-or-color.js';
import noDialogRootOutsidePatterns from './no-dialog-root-outside-patterns.js';
import noDirectToast from './no-direct-toast.js';
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
  ],
  invalid: [
    {
      code: '<div class="duration-[120ms] bg-[#123456]" />',
      errors: [{ messageId: 'arbitraryToken' }],
    },
    {
      code: '<script>const classes = `ease-[linear] text-[#fff]`;</script>',
      errors: [{ messageId: 'arbitraryToken' }],
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
