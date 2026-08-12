import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '$lib/components/ui/button/button.variants';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/components/modals/SetupScriptModal.svelte'),
  'utf8',
);

describe('SetupScriptModal primary actions', () => {
  it('keeps Done and Save and Done on the theme-safe default button variant', () => {
    expect(source).toContain('<Button variant="default" onclick={handleSaveAndDone}>');
    expect(source).toContain('<Button variant="default" onclick={handleDone}>');
    expect(source).not.toContain('text-white');

    const defaultClasses = buttonVariants({ variant: 'default' });
    expect(defaultClasses).toContain('bg-card');
    expect(defaultClasses).toContain('text-foreground');
  });
});
