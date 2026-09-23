import { expect, test } from '../../../test/ct-test';
import DirectoryPickerView from './DirectoryPickerView.svelte';

const listing = {
  path: '/fixture/projects',
  parent: '/fixture',
  home: '/fixture',
  entries: ['alpha', 'beta'].map((name) => ({
    name,
    path: `/fixture/projects/${name}`,
    isDirectory: true,
    isGitRepo: false,
  })),
};

test('directory keyboard navigation and folder creation preserve callback paths', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const navigated: Array<string | undefined> = [];
  const created: string[] = [];
  let closed = false;
  await mount(DirectoryPickerView, {
    props: {
      open: true,
      listing,
      loading: false,
      error: null,
      pathError: null,
      onNavigate: (path) => {
        navigated.push(path);
      },
      onNavigateToPath: (path) => {
        navigated.push(path);
      },
      onCreateDirectory: (path) => {
        created.push(path);
      },
      onClearPathError: () => {},
      onSelect: () => {},
      onClose: () => {
        closed = true;
      },
    },
  });
  const contents = page.getByRole('listbox');
  await contents.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture/projects/beta');
  await page.keyboard.press('Backspace');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture');
  await page.getByRole('button', { name: 'Enter a folder path', exact: true }).click();
  await page.getByRole('textbox', { name: 'Path', exact: true }).fill('~/other');
  await page.keyboard.press('Enter');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture/other');
  await page.keyboard.press('Escape');
  expect(closed).toBe(false);
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('  example  ');
  await page.keyboard.press('Enter');
  await expect.poll(() => created).toEqual(['/fixture/projects/example']);
  await page.keyboard.press('Escape');
  expect(closed).toBe(false);
  await contents.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => closed).toBe(true);
});

test('directory retry requests the listing and path retry restores editing', async ({
  mount,
  page,
}) => {
  let retried: string | undefined;
  let cleared = false;
  const props = {
    open: true,
    listing,
    loading: false,
    error: 'Permission denied while reading this directory.',
    pathError: null,
    onNavigate: (path?: string) => {
      retried = path;
    },
    onNavigateToPath: () => {},
    onClearPathError: () => {
      cleared = true;
    },
    onSelect: () => {},
    onClose: () => {},
  };
  const component = await mount(DirectoryPickerView, { props });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => retried).toBe(listing.path);
  await component.update({ props: { ...props, error: null, pathError: 'Folder does not exist.' } });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => cleared).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Path', exact: true })).toBeFocused();
});
