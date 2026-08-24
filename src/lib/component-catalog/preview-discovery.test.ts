import { describe, expect, it } from 'vitest';
import {
  createPreviewLoaderIndex,
  listPreviewIds,
  loadPreviewFromLoader,
} from './preview-discovery';

const component = () => undefined;

function loader(id: string, states: Record<string, { props: Record<string, unknown> }> = {}) {
  return async () => ({
    default: component,
    preview: {
      id,
      title: id,
      defaultState: Object.keys(states)[0] ?? 'default',
      states,
    },
  });
}

describe('preview discovery', () => {
  it('finds colocated previews without a shared registry entry', () => {
    const ids = listPreviewIds();
    expect(ids).toEqual(expect.arrayContaining(['button', 'mention-agent-avatar']));
    expect(ids).toEqual([...ids].sort());
  });

  it('rejects duplicate filenames instead of silently replacing a preview', () => {
    expect(() =>
      createPreviewLoaderIndex([
        ['/src/one/example.preview.ts', loader('example')],
        ['/src/two/example.preview.svelte', loader('example')],
      ]),
    ).toThrow(
      'Duplicate preview slug “example” in “/src/one/example.preview.ts” and “/src/two/example.preview.svelte”.',
    );
  });

  it('rejects a loaded definition whose id does not match the filename', async () => {
    await expect(
      loadPreviewFromLoader('example', loader('different', { default: { props: {} } })),
    ).rejects.toThrow('Preview slug “example” does not match definition id “different”.');
  });

  it('rejects a loaded definition with no states', async () => {
    await expect(loadPreviewFromLoader('example', loader('example'))).rejects.toThrow(
      'Preview “example” must define at least one state.',
    );
  });
});
