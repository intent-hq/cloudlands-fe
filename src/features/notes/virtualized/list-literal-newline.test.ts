import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SourceProjection } from './projection/source-projection';

it('preserves native literal list newlines and their source positions beside hard breaks', () => {
  const literal = 'café 🌍\nnext';
  const source = literal + '\nlast';
  const start = 37;
  const native = new Editor({ extensions: [StarterKit], content: '<p></p>' });
  try {
    native.view.dispatch(native.state.tr.insertText(literal));
    native.commands.setHardBreak();
    native.commands.insertContent('last');
    const projection = new SourceProjection(source, start, {
      revision: 1,
      from: start,
      to: start + source.length,
      before: [],
      after: [],
      listParagraph: true,
      literalNewlines: [{ from: start, to: start + literal.length }],
    });
    expect(native.schema.nodeFromJSON(projection.content).toJSON()).toEqual(native.getJSON());
    for (let offset = 0; offset <= source.length; offset++) {
      expect(projection.sourceAt(projection.pmAt(start + offset))).toBe(start + offset);
    }
  } finally {
    native.destroy();
  }
});
