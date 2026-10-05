// @verify-changed-triggers: src/**, scripts/check-update-channel-writer.mjs

import { describe, expect, it } from 'vitest';
import {
  DISPATCH_SITES,
  WRITER_PATH,
  checkUpdateChannelWriter,
  collectSourceFiles,
  isScannedPath,
} from './check-update-channel-writer.mjs';

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join('\n') });

const compliant = [
  file(WRITER_PATH, 'yield call([autoUpdateClient, autoUpdateClient.setChannel], channel);'),
  file(DISPATCH_SITES[0], 'appStore.dispatch(setUpdateChannel(value as UpdateChannel));'),
  file(DISPATCH_SITES[1], 'store.dispatch(setUpdateChannel(proposal.channel));'),
];

describe('update-channel single-writer guard', () => {
  it.each([
    ['saga', 'src/store/renderer/slices/x/sagas/x-saga.ts', true],
    ['component', 'src/routes/(app)/settings/+page.svelte', true],
    ['unit test', 'src/features/auto-update/auto-update.client.test.ts', false],
    ['__tests__ fixture', 'src/features/auto-update/__tests__/fixture.ts', false],
    ['CT spec', 'src/lib/components/x/x.ct.spec.ts', false],
    ['stylesheet', 'src/app.css', false],
  ])('%s path scanned=%s', (_name, path, scanned) => {
    expect(isScannedPath(path)).toBe(scanned);
  });

  it('passes when only the saga writes and every UI surface dispatches', () => {
    expect(checkUpdateChannelWriter(compliant)).toEqual({
      hits: [],
      missingWriter: false,
      missingDispatch: [],
    });
  });

  it('reports a direct setChannel call outside the saga, skipping tests', () => {
    const files = [
      ...compliant,
      file(
        'src/routes/(app)/settings/+page.svelte',
        'await autoUpdateClient.setChannel(value as UpdateChannel);',
        'appStore.dispatch(setUpdateChannel(value as UpdateChannel));',
      ),
      file(
        'src/features/auto-update/__tests__/probe.test.ts',
        "await autoUpdateClient.setChannel('beta');",
      ),
    ];
    expect(checkUpdateChannelWriter(files)).toEqual({
      hits: [
        {
          path: 'src/routes/(app)/settings/+page.svelte',
          line: 1,
          text: 'await autoUpdateClient.setChannel(value as UpdateChannel);',
        },
      ],
      missingWriter: false,
      missingDispatch: [],
    });
  });

  it('reports a saga that stopped writing and UI surfaces that stopped dispatching', () => {
    const files = [
      file(WRITER_PATH, 'yield take(setUpdateChannel);'),
      file(DISPATCH_SITES[0], 'channel = value;'),
    ];
    expect(checkUpdateChannelWriter(files)).toEqual({
      hits: [],
      missingWriter: true,
      missingDispatch: [...DISPATCH_SITES],
    });
  });

  it('passes on the current tree and fails once a UI surface writes directly', () => {
    const tree = collectSourceFiles(process.cwd());
    expect(checkUpdateChannelWriter(tree)).toEqual({
      hits: [],
      missingWriter: false,
      missingDispatch: [],
    });
    const added = file(
      'src/lib/components/settings/ChannelPicker.svelte',
      "await autoUpdateClient.setChannel('stable');",
    );
    expect(checkUpdateChannelWriter([...tree, added]).hits).toEqual([
      { path: added.path, line: 1, text: added.content },
    ]);
  });
});
