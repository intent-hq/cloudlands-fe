import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { ReplaceStep, type StepMap } from '@tiptap/pm/transform';
import type { NoteScope, NoteSplice } from '$lib/client/note-pages';
import { SourceProjection } from '../projection/source-projection';
import type { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';

type Owner = Extract<NoteWindow['context'][number], { kind: 'boundary' }>;
type Token = {
  pm: number;
  start: number;
  end: number;
  text: string;
  owner: string;
  encoding: 'markdown' | 'html';
  construct: string;
};
export type NoteReplayEdit = {
  splice: NoteSplice;
  before: string;
  tokens: Array<{ pm: number; start: number; end: number; text: string }>;
};
type Navigation = {
  forward: Map<number, number>;
  backward: Map<number, number>;
  original: SourceProjection;
  changes: Array<{ shift: number } | { start: number; end: number; size: number; pm: StepMap }>;
};
const mapSource = (p: number, start: number, end: number, size: number, affinity = 1) =>
  p < start || (p === start && affinity < 0)
    ? p
    : p > end || (p === end && affinity > 0)
      ? p + size - end + start
      : start + (affinity < 0 ? 0 : size);
const supported = new Set(['paragraph', 'heading', 'strong', 'emphasis', 'strikethrough', 'link']);
const scalarBoundary = (text: string, at: number) =>
  at === 0 ||
  at === text.length ||
  !(
    text.charCodeAt(at - 1) >= 0xd800 &&
    text.charCodeAt(at - 1) <= 0xdbff &&
    text.charCodeAt(at) >= 0xdc00 &&
    text.charCodeAt(at) <= 0xdfff
  );
const scalarText = (text: string) =>
  [...text].every((c) => c.length === 2 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff);
const encode = (text: string, encoding: Token['encoding']) =>
  encoding === 'html'
    ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');

/** Runtime-only bounded authority. Never store PM documents or this object in
 * Redux. Its exact lexical tokens are stricter than selection-affinity maps. */
export class NoteEditAuthority extends SourceProjection {
  constructor(
    readonly scope: NoteScope,
    readonly sourceRevision: string,
    readonly snapshotId: string,
    readonly generation: number,
    source: string,
    start: number,
    readonly doc: PMNode,
    private readonly lexical: readonly Token[],
    private readonly navigation: Navigation,
    readonly baseLength: number,
  ) {
    super(source, start, {
      canonical: true,
      revision: generation,
      from: start,
      to: start + source.length,
      before: [],
      after: [],
    });
    Object.assign(this.content, doc.toJSON());
    for (const [pm, source] of navigation.forward) this.positions.set(pm, source);
    for (const [pm, source] of navigation.backward) this.ends.set(pm, source);
    for (const token of lexical) {
      this.positions.set(token.pm, token.start);
      this.ends.set(token.pm + token.text.length, token.end);
      this.positions.set(token.pm + token.text.length, token.end);
    }
  }

  override sourceAt(pm: number, affinity = 1) {
    const inside = this.lexical.find((t) => pm > t.pm && pm < t.pm + t.text.length);
    if (inside) return affinity < 0 ? inside.start : inside.end;
    return super.sourceAt(pm, affinity);
  }
  override pmAt(source: number, affinity = 1) {
    const token = this.lexical.find((t) => source >= t.start && source <= t.end);
    if (token) {
      if (source === token.start) return token.pm;
      if (source === token.end) return token.pm + token.text.length;
      return token.end - token.start === token.text.length
        ? token.pm + source - token.start
        : token.pm + (affinity < 0 ? 0 : token.text.length);
    }
    let original = source;
    for (const c of this.navigation.changes.slice().reverse())
      original =
        'shift' in c
          ? original - c.shift
          : mapSource(original, c.start, c.start + c.size, c.end - c.start, affinity);
    let pm = this.navigation.original.pmAt(original, affinity);
    for (const c of this.navigation.changes) if (!('shift' in c)) pm = c.pm.map(pm, affinity);
    return pm;
  }

  /** Only same-owner, fully covered inline edits are admitted. No guessed source
   * endpoints, structural serialization, or mutation of the input projection. */
  replace(step: ReplaceStep, before: PMNode, replay?: NoteReplayEdit) {
    if (this.navigation.changes.length >= 2048) throw new Error('Note mapping budget exceeded');
    if (!before.eq(this.doc)) throw new Error('Stale note edit document');
    if (step.slice.openStart || step.slice.openEnd)
      throw new Error('Unsupported structural note edit');
    const left = before.resolve(step.from),
      right = before.resolve(step.to);
    if (!left.sameParent(right) || !left.parent.isTextblock)
      throw new Error('Unsupported structural note edit');
    const marks = left.marks();
    if (left.parent.type.name === 'codeBlock' || marks.some((m) => m.type.name === 'code'))
      throw new Error('Code requires its lexical serializer');
    let inserted = '';
    step.slice.content.forEach((node) => {
      if (!node.isText || !node.hasMarkup(node.type, node.attrs, marks))
        throw new Error('Unsupported note edit marks');
      inserted += node.text ?? '';
    });
    before.nodesBetween(step.from, step.to, (node) => {
      if (node.isInline && (!node.isText || !node.hasMarkup(node.type, node.attrs, marks)))
        throw new Error('Unsupported note edit marks');
    });
    if (!replay && (!scalarText(inserted) || /[\u0000-\u001f\u007f]/.test(inserted)))
      throw new Error('Unsupported scalar or multiline note insertion');
    const points = this.lexical.filter(
      (t) => t.pm === step.from || t.pm + t.text.length === step.from,
    );
    const ends = this.lexical.filter((t) => t.pm === step.to || t.pm + t.text.length === step.to);
    const startAt = (t: Token, p: number) => (p === t.pm ? t.start : t.end);
    const candidates = points.flatMap((a) =>
      ends
        .filter((b) => b.owner === a.owner && b.encoding === a.encoding)
        .map((b) => ({ start: startAt(a, step.from), end: startAt(b, step.to), token: a })),
    );
    const valid = candidates.filter((c) => {
      if (c.start > c.end) return false;
      let pm = step.from,
        source = c.start;
      for (const t of this.lexical.filter((t) => t.pm >= step.from && t.pm < step.to)) {
        if (
          t.pm !== pm ||
          t.start !== source ||
          t.owner !== c.token.owner ||
          t.encoding !== c.token.encoding ||
          t.pm + t.text.length > step.to
        )
          return false;
        pm += t.text.length;
        source = t.end;
      }
      return pm === step.to && source === c.end;
    });
    const selected = valid[0];
    if (!selected || valid.some((c) => c.start !== selected.start || c.end !== selected.end))
      throw new Error('Missing exact lexical coverage');
    const { start, end, token } = selected;
    const sourceNode = before.nodeAt(token.pm);
    if (sourceNode?.isText && !sourceNode.hasMarkup(sourceNode.type, sourceNode.attrs, marks))
      throw new Error('Lexical owner marks differ from insertion marks');
    const ownerTokens = this.lexical.filter((t) => t.owner === token.owner);
    const lastOwnerToken = ownerTokens[ownerTokens.length - 1];
    const ownerStart = ownerTokens[0].pm,
      ownerEnd = lastOwnerToken.pm + lastOwnerToken.text.length;
    if (
      !replay &&
      token.encoding === 'markdown' &&
      !['paragraph', 'heading'].includes(token.construct) &&
      (step.from === ownerStart || step.to === ownerEnd)
    )
      throw new Error('Marked owner boundary requires delimiter repair');
    if (
      !replay &&
      !inserted &&
      this.lexical
        .filter((t) => t.owner === token.owner)
        .every((t) => t.pm >= step.from && t.pm + t.text.length <= step.to)
    )
      throw new Error('Deleting a lexical owner requires structural repair');
    if (
      !scalarBoundary(this.source, start - this.start) ||
      !scalarBoundary(this.source, end - this.start)
    )
      throw new Error('Note edit splits a Unicode scalar');
    // Native HTML ingestion collapses adjacent whitespace. Such edits need a
    // lexical whitespace owner; do not silently change their rendered meaning.
    const nearby = before.textBetween(
      Math.max(left.start(), step.from - 1),
      Math.min(left.end(), step.to + 1),
    );
    const prefix = before.textBetween(left.start(), step.from),
      suffix = before.textBetween(step.to, left.end());
    const resultText = prefix + inserted + suffix;
    if (
      !replay &&
      ((/^\s/.test(resultText) && !/^\s/.test(left.parent.textContent)) ||
        (/\s$/.test(resultText) && !/\s$/.test(left.parent.textContent)) ||
        (!inserted && /\s$/.test(prefix) && /^\s/.test(suffix)))
    )
      throw new Error('Unsupported whitespace normalization');
    if (
      !replay &&
      /\s/.test(inserted) &&
      (/\s{2}/.test(inserted) ||
        (/^\s/.test(inserted) && (step.from === left.start() || /^\s/.test(nearby))) ||
        (/\s$/.test(inserted) && (step.to === left.end() || /\s$/.test(nearby))))
    )
      throw new Error('Unsupported whitespace normalization');
    const text = replay?.splice.text ?? encode(inserted, token.encoding);
    const splice: NoteSplice = { start, end, text };
    const inverse: NoteSplice = {
      start,
      end: start + text.length,
      text: this.source.slice(start - this.start, end - this.start),
    };
    if (
      replay &&
      (replay.splice.start !== start || replay.splice.end !== end || replay.before !== inverse.text)
    )
      throw new Error('Dirty replay source mismatch');
    const applied = step.apply(before);
    if (!applied.doc) throw new Error(applied.failed ?? 'Invalid note edit');
    const delta = text.length - (end - start),
      mapping = step.getMap();
    const tokens = this.lexical
      .filter((t) => t.pm + t.text.length <= step.from || t.pm >= step.to)
      .filter((t) => t.text.length > 0)
      .map((t) => ({
        ...t,
        pm: mapping.map(t.pm, t.pm >= step.to ? 1 : -1),
        start: t.start >= end ? t.start + delta : t.start,
        end: t.start >= end ? t.end + delta : t.end,
      }));
    const removed = this.lexical
      .filter((t) => t.pm >= step.from && t.pm + t.text.length <= step.to && t.text.length > 0)
      .map((t) => ({
        pm: t.pm - step.from,
        start: t.start - start,
        end: t.end - start,
        text: t.text,
      }));
    const added: NoteReplayEdit['tokens'] = [];
    let pm = step.from,
      source = start;
    if (replay) added.push(...replay.tokens);
    else
      for (const c of inserted) {
        const raw = encode(c, token.encoding);
        added.push({
          pm: pm - step.from,
          start: source - start,
          end: source + raw.length - start,
          text: c,
        });
        pm += c.length;
        source += raw.length;
      }
    for (const t of added)
      tokens.push({
        ...token,
        ...t,
        pm: t.pm + step.from,
        start: t.start + start,
        end: t.end + start,
      });
    // Empty textblocks still have an exact insertion point after deleting all text.
    if (!tokens.some((t) => t.owner === token.owner))
      tokens.push({ ...token, pm: step.from, start, end: start, text: '' });
    tokens.sort((a, b) => a.pm - b.pm);
    const next = new NoteEditAuthority(
      this.scope,
      this.sourceRevision,
      this.snapshotId,
      this.generation,
      this.source.slice(0, start - this.start) + text + this.source.slice(end - this.start),
      this.start,
      applied.doc,
      tokens,
      {
        original: this.navigation.original,
        changes: [...this.navigation.changes, { start, end, size: text.length, pm: mapping }],
        forward: new Map(
          [...this.positions].map(([p, s]) => [
            mapping.map(p, 1),
            mapSource(s, start, end, text.length, 1),
          ]),
        ),
        backward: new Map(
          [...this.ends].map(([p, s]) => [
            mapping.map(p, -1),
            mapSource(s, start, end, text.length, -1),
          ]),
        ),
      },
      this.baseLength,
    );
    return {
      authority: next,
      splice,
      inverse,
      forwardReplay: { splice, before: inverse.text, tokens: added } satisfies NoteReplayEdit,
      inverseReplay: { splice: inverse, before: text, tokens: removed } satisfies NoteReplayEdit,
    };
  }

  replay(edit: NoteReplayEdit) {
    const { start, end, text } = edit.splice;
    const stop = this.start + this.source.length;
    if (end <= this.start && start < this.start) return this.shift(text.length - end + start);
    if (start > stop) return this;
    if (start < this.start || end > stop)
      throw new Error('Dirty replay requires complete edit coverage');
    const left =
      this.lexical.find((t) => t.start === start) ?? this.lexical.find((t) => t.end === start);
    const right =
      this.lexical.find((t) => t.end === end) ?? this.lexical.find((t) => t.start === end);
    if (!left || !right) throw new Error('Dirty replay lacks exact lexical coverage');
    const from = left.start === start ? left.pm : left.pm + left.text.length;
    const to = right.end === end ? right.pm + right.text.length : right.pm;
    const rendered = edit.tokens.map((t) => t.text).join('');
    const content = rendered
      ? Fragment.from(this.doc.type.schema.text(rendered, this.doc.resolve(from).marks()))
      : Fragment.empty;
    return this.replace(new ReplaceStep(from, to, new Slice(content, 0, 0)), this.doc, edit)
      .authority;
  }

  private shift(delta: number) {
    return new NoteEditAuthority(
      this.scope,
      this.sourceRevision,
      this.snapshotId,
      this.generation,
      this.source,
      this.start + delta,
      this.doc,
      this.lexical.map((t) => ({ ...t, start: t.start + delta, end: t.end + delta })),
      {
        original: this.navigation.original,
        changes: [...this.navigation.changes, { shift: delta }],
        forward: new Map([...this.positions].map(([p, s]) => [p, s + delta])),
        backward: new Map([...this.ends].map(([p, s]) => [p, s + delta])),
      },
      this.baseLength,
    );
  }

  atGeneration(generation: number) {
    return new NoteEditAuthority(
      this.scope,
      this.sourceRevision,
      this.snapshotId,
      generation,
      this.source,
      this.start,
      this.doc,
      this.lexical,
      this.navigation,
      this.baseLength,
    );
  }
}

/** Resolve compact owners with noteCanonicalOwnerSteps before calling. Owner
 * descriptors and their details must come from the same admitted snapshot. An
 * absent lexical owner leaves its text read-only; selection maps are not proof. */
export function createNoteEditAuthority(
  window: NoteWindow,
  projection: NoteCanonicalProjection,
  owners: readonly Owner[],
  doc: PMNode,
): NoteEditAuthority {
  if (
    !window.native ||
    !doc.eq(doc.type.schema.nodeFromJSON(projection.content)) ||
    projection.source !== window.text ||
    projection.start !== window.range.start
  )
    throw new Error('Mismatched note edit projection');
  if (window.text.length > 32768 || doc.content.size > 32768)
    throw new Error('Note edit authority budget exceeded');
  if (!scalarText(window.text) || window.text.length !== window.range.end - window.range.start)
    throw new Error('Invalid note source window');
  const tokens: Token[] = [];
  const bodies = new Map<string, { start: number; end: number }>();
  const maps = window.context.filter((m) => m.kind === 'sourceMap');
  for (const entry of projection.nativeEntries.filter((n) => n.nodeType === 'text')) {
    let pm = entry.from;
    for (const map of maps
      .filter((m) => m.textNodeId === entry.id && m.mapping !== 'omitted')
      .sort((a, b) => a.renderedRange.start - b.renderedRange.start)) {
      const text = map.textRef ? window.native.texts[map.textRef] : undefined;
      if (text === undefined) throw new Error('Missing note edit rendered text');
      const at = pm;
      pm += text.length;
      const ownerIds = window.native.references[map.ownerRef];
      const owner = ownerIds?.length === 1 ? owners.find((o) => o.id === ownerIds[0]) : undefined;
      if (
        !owner ||
        !supported.has(owner.construct) ||
        !owner.entryPath ||
        map.mapping === 'projection'
      )
        continue;
      const compact = window.canonicalOwners?.find((o) => o.ownerId === owner.id);
      if (
        compact &&
        (compact.nativeRef !== owner.nativeRef ||
          compact.construct !== owner.construct ||
          compact.sourceRange.start !== owner.sourceRange.start ||
          compact.sourceRange.end !== owner.sourceRange.end ||
          JSON.stringify(compact.htmlSource) !== JSON.stringify(owner.htmlSource))
      )
        throw new Error('Lexical owner identity changed');
      const details = window.details[owner.id];
      let body = owner.htmlSource?.bodyRange;
      if (owner.entryPath === 'html') {
        if (owner.htmlSource?.provenance !== 'explicit' || !body) continue;
      } else {
        if (details?.openingSource === undefined || details.closingSource === undefined) continue;
        body = {
          start: owner.sourceRange.start + details.openingSource.length,
          end: owner.sourceRange.end - details.closingSource.length,
        };
      }
      const { start, end } = map.sourceRange;
      if (
        !body ||
        start < body.start ||
        end > body.end ||
        start < window.range.start ||
        end > window.range.end ||
        start >= end
      )
        continue;
      // A clipped owner is navigation authority only. Its unseen delimiters or
      // whitespace cannot be certified by an identity/affinity map.
      if (body.start < window.range.start || body.end > window.range.end) continue;
      bodies.set(owner.id, body);
      const raw = window.text.slice(start - window.range.start, end - window.range.start);
      if (
        !scalarText(raw) ||
        !scalarText(text) ||
        !scalarBoundary(window.text, start - window.range.start) ||
        !scalarBoundary(window.text, end - window.range.start)
      )
        continue;
      const token: Token = {
        pm: at,
        start,
        end,
        text,
        owner: owner.id,
        encoding: owner.entryPath,
        construct: owner.construct,
      };
      if (map.mapping === 'identity') {
        if (raw !== text) throw new Error('Identity edit mapping differs from source');
        // Identity means positional equality, not lexical independence. Deleting
        // letters beside raw Markdown punctuation can create headings/links or
        // delimiters; raw HTML ampersands/angles can become entities/tags. This
        // first slice admits transparent text only. Syntax-bearing identity runs
        // need the owner's full lexical serializer, even when their map is exact.
        if (
          owner.entryPath === 'markdown'
            ? /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(raw)
            : /[<&]/.test(raw)
        )
          continue;
        let offset = 0;
        for (const c of text) {
          tokens.push({
            ...token,
            pm: at + offset,
            start: start + offset,
            end: start + offset + c.length,
            text: c,
          });
          offset += c.length;
        }
      } else if (map.mapping === 'entity' || map.mapping === 'normalized') tokens.push(token);
    }
  }
  tokens.sort((a, b) => a.pm - b.pm);
  for (let i = 1; i < tokens.length; i++)
    if (
      tokens[i].pm < tokens[i - 1].pm + tokens[i - 1].text.length ||
      tokens[i].start < tokens[i - 1].end
    )
      throw new Error('Overlapping edit coverage');
  const complete = new Set<string>();
  for (const [id, body] of bodies) {
    let cursor = body.start;
    for (const token of tokens.filter((t) => t.owner === id)) {
      if (token.start !== cursor) break;
      cursor = token.end;
    }
    if (cursor === body.end) complete.add(id);
  }
  return new NoteEditAuthority(
    { ...window.scope },
    window.sourceRevision,
    window.snapshotId,
    0,
    window.text,
    window.range.start,
    doc,
    tokens.filter((t) => complete.has(t.owner)),
    {
      original: projection,
      changes: [],
      forward: new Map(
        Array.from({ length: doc.content.size + 1 }, (_, pm) => {
          try {
            return [pm, projection.sourceAt(pm, 1)] as const;
          } catch {
            return undefined;
          }
        }).filter((p) => p !== undefined),
      ),
      backward: new Map(
        Array.from({ length: doc.content.size + 1 }, (_, pm) => {
          try {
            return [pm, projection.sourceAt(pm, -1)] as const;
          } catch {
            return undefined;
          }
        }).filter((p) => p !== undefined),
      ),
    },
    window.sourceLength,
  );
}
