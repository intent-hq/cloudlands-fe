import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import {
  edgeDiffMapFixture,
  hugeDiffMapFixture,
  largeDiffMapFixture,
  monorepoDiffMapFixture,
  tinyDiffMapFixture,
  typicalDiffMapFixture,
} from '../model/fixtures';
import DiffMapPreview from './DiffMapPreview.svelte';

type DiffMapProps = ComponentProps<typeof DiffMapPreview>;

const onOpen: DiffMapProps['onOpen'] = () => {};

function props(document: DiffMapProps['document']): DiffMapProps {
  return { document, onOpen, activePath: document.files[0]?.path };
}

function viewedProps(): DiffMapProps {
  const document = typicalDiffMapFixture.document;
  return {
    document,
    onOpen,
    activePath: document.files[2]?.path,
    layers: {
      viewed: new Set(document.files.slice(0, 1).map((file) => file.path)),
      changedSinceViewed: new Set(document.files.slice(1, 2).map((file) => file.path)),
    },
  };
}

export const preview = definePreview<DiffMapProps>({
  id: 'diff-map',
  title: 'Diff map',
  defaultState: 'typical',
  states: {
    tiny: { props: props(tinyDiffMapFixture.document) },
    typical: { props: props(typicalDiffMapFixture.document) },
    viewed: { props: viewedProps() },
    large: { props: props(largeDiffMapFixture.document) },
    huge: { props: props(hugeDiffMapFixture.document) },
    monorepo: { props: props(monorepoDiffMapFixture.document) },
    edge: { props: props(edgeDiffMapFixture.document) },
  },
});

export default DiffMapPreview;
