<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    ArtifactDocument,
    ArtifactItem,
    ArtifactSelection,
  } from '$shared/types/visual-artifact';
  import { displayImageSource } from './editor-actions';
  import { moveItems, removeItems } from './editor-actions';
  let {
    document,
    imageSources = {},
    onChange,
    onSelect,
    selection,
    readonly,
  }: {
    document: ArtifactDocument;
    imageSources?: Record<string, string>;
    onChange: (document: ArtifactDocument) => void;
    onSelect: (selection: ArtifactSelection) => void;
    selection: ArtifactSelection;
    readonly: boolean;
  } = $props();
  let drag = $state<{
    pointer: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    ids: string[];
  }>();
  const selected = $derived(document.items.filter((item) => selection.itemIds.includes(item.id)));
  const first = $derived(selected.length === 1 ? selected[0] : undefined);
  const minX = $derived(Math.min(0, ...document.items.map((item) => item.x - 20)));
  const minY = $derived(Math.min(0, ...document.items.map((item) => item.y - 20)));
  const width = $derived(
    Math.max(760, ...document.items.map((item) => item.x + item.width + 80)) - minX,
  );
  const height = $derived(
    Math.max(440, ...document.items.map((item) => item.y + item.height + 80)) - minY,
  );
  function select(id: string, extend: boolean) {
    const item = document.items.find((item) => item.id === id);
    const targets = item?.group
      ? document.items.filter((value) => value.group === item.group).map((value) => value.id)
      : [id];
    const ids = extend
      ? targets.every((target) => selection.itemIds.includes(target))
        ? selection.itemIds.filter((value) => !targets.includes(value))
        : [...new Set([...selection.itemIds, ...targets])]
      : targets;
    onSelect({ itemIds: ids });
    return ids;
  }
  function start(event: PointerEvent, item: ArtifactItem) {
    if (event.button !== 0) return;
    const ids =
      event.shiftKey || !selection.itemIds.includes(item.id)
        ? select(item.id, event.shiftKey)
        : selection.itemIds;
    if (readonly || event.shiftKey) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, ids };
  }
  function move(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    drag = { ...drag, dx: event.clientX - drag.x, dy: event.clientY - drag.y };
  }
  function finish(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    if (!readonly && (drag.dx || drag.dy))
      onChange(moveItems(document, drag.ids, drag.dx, drag.dy));
    drag = undefined;
  }
  function remove(ids = selection.itemIds) {
    if (readonly) return;
    onChange(removeItems(document, ids));
    onSelect({ itemIds: [] });
  }
  function key(event: KeyboardEvent, item: ArtifactItem) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(item.id, event.shiftKey);
      return;
    }
    if (event.key === 'Escape') {
      drag = undefined;
      onSelect({ itemIds: [] });
      return;
    }
    if (readonly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(selection.itemIds.includes(item.id) ? selection.itemIds : [item.id]);
      return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (delta[event.key]) {
      event.preventDefault();
      const [x, y] = delta[event.key];
      onChange(
        moveItems(
          document,
          selection.itemIds.includes(item.id) ? selection.itemIds : [item.id],
          x * (event.shiftKey ? 10 : 1),
          y * (event.shiftKey ? 10 : 1),
        ),
      );
    }
  }
  function add(type: ArtifactItem['type']) {
    if (readonly || document.items.length >= 200) return;
    const id = crypto.randomUUID();
    onChange({
      ...document,
      items: [
        ...document.items,
        {
          id,
          type,
          text:
            type === 'text'
              ? m.artifact_editor_text()
              : type === 'image'
                ? m.artifact_editor_image()
                : m.artifact_editor_card(),
          x: 40 + (document.items.length % 4) * 40,
          y: 40 + (document.items.length % 4) * 40,
          width: 220,
          height: 140,
        },
      ],
    });
    onSelect({ itemIds: [id] });
  }
  function update(patch: Partial<ArtifactItem>) {
    if (!first || readonly) return;
    onChange({
      ...document,
      items: document.items.map((item) => (item.id === first.id ? { ...item, ...patch } : item)),
    });
  }
  function group() {
    const group = crypto.randomUUID();
    onChange({
      ...document,
      items: document.items.map((item) =>
        selection.itemIds.includes(item.id) ? { ...item, group } : item,
      ),
    });
  }
  function connect() {
    if (selected.length !== 2 || document.connections.length >= 400) return;
    const [from, to] = selected.map((item) => item.id);
    if (document.connections.some((edge) => edge.from === from && edge.to === to)) return;
    onChange({
      ...document,
      connections: [...document.connections, { id: crypto.randomUUID(), from, to }],
    });
  }
  function position(item: ArtifactItem) {
    return {
      x: item.x - minX + (drag?.ids.includes(item.id) ? drag.dx : 0),
      y: item.y - minY + (drag?.ids.includes(item.id) ? drag.dy : 0),
    };
  }
</script>

<div class="artifact-toolbar">
  {#if !readonly}
    <Button variant="outline" onclick={() => add('card')} disabled={document.items.length >= 200}
      >＋ {m.artifact_editor_card()}</Button
    >
    <Button variant="outline" onclick={() => add('text')} disabled={document.items.length >= 200}
      >＋ {m.artifact_editor_text()}</Button
    >
    <Button variant="outline" onclick={() => add('image')} disabled={document.items.length >= 200}
      >＋ {m.artifact_editor_image()}</Button
    >
    <span class="artifact-divider"></span>
    <Button variant="outline" onclick={group} disabled={selected.length < 2}
      >{m.artifact_editor_group()}</Button
    >
    <Button
      variant="outline"
      onclick={connect}
      disabled={selected.length !== 2 || document.connections.length >= 400}
      >{m.artifact_editor_connect()}</Button
    >
    <Button variant="outline" onclick={() => remove()} disabled={!selected.length}
      >{m.artifact_editor_delete()}</Button
    >
  {/if}
  <Button
    variant="outline"
    onclick={() => onSelect({ itemIds: document.items.map((item) => item.id) })}
    >{m.artifact_editor_select_all()}</Button
  >
</div>
<p class="artifact-hint">{m.artifact_editor_board_hint()}</p>
<div class="artifact-board-scroll">
  <div class="artifact-board" style:width="{width}px" style:height="{height}px">
    <svg class="artifact-edges" {width} {height} aria-hidden="true">
      {#each document.connections as edge (edge.id)}
        {@const from = document.items.find((item) => item.id === edge.from)}
        {@const to = document.items.find((item) => item.id === edge.to)}
        {#if from && to}
          <line
            x1={position(from).x + from.width / 2}
            y1={position(from).y + from.height / 2}
            x2={position(to).x + to.width / 2}
            y2={position(to).y + to.height / 2}
          />
        {/if}
      {/each}
    </svg>
    {#each document.items as item (item.id)}
      <Button
        variant="outline"
        class={`artifact-node ${item.type === 'text' ? 'artifact-text' : ''} ${item.group ? 'artifact-grouped' : ''} ${selection.itemIds.includes(item.id) ? 'artifact-selected' : ''}`}
        style={`left:${position(item).x}px;top:${position(item).y}px;width:${item.width}px;height:${item.height}px`}
        aria-pressed={selection.itemIds.includes(item.id)}
        onpointerdown={(event) => start(event, item)}
        onpointermove={move}
        onpointerup={finish}
        onpointercancel={() => (drag = undefined)}
        onkeydown={(event) => key(event, item)}
        onclick={(event) => {
          if (event.detail === 0) select(item.id, event.shiftKey);
        }}
      >
        {#if item.type === 'image' && item.src && displayImageSource(item.src, imageSources)}<img
            src={displayImageSource(item.src, imageSources)}
            alt={item.text}
            draggable="false"
          />{:else}<span>{item.text}</span>{/if}
      </Button>
    {/each}
  </div>
</div>
{#if first && !readonly}
  <div class="artifact-inspector">
    <label
      >{m.artifact_editor_text()}<Textarea
        value={first.text}
        maxlength={16000}
        oninput={(event) => update({ text: event.currentTarget.value })}
      ></Textarea></label
    >
    {#if first.type === 'image'}<label
        >{m.artifact_editor_source()}<Input
          value={first.src ?? ''}
          maxlength={200000}
          onchange={(event) => update({ src: event.currentTarget.value })}
        /></label
      >{/if}
  </div>
{/if}
{#if selected.some((item) => item.group) && !readonly}
  <Button
    variant="outline"
    onclick={() =>
      onChange({
        ...document,
        items: document.items.map((item) =>
          selection.itemIds.includes(item.id) ? { ...item, group: undefined } : item,
        ),
      })}>{m.artifact_editor_ungroup()}</Button
  >
{/if}
{#if document.connections.length && !readonly}
  <div class="artifact-connections">
    {#each document.connections.filter((edge) => selection.itemIds.includes(edge.from) || selection.itemIds.includes(edge.to)) as edge (edge.id)}
      <Button
        variant="outline"
        onclick={() =>
          onChange({
            ...document,
            connections: document.connections.filter((value) => value.id !== edge.id),
          })}
        >{m.artifact_editor_disconnect()} · {document.items.find((item) => item.id === edge.from)
          ?.text} → {document.items.find((item) => item.id === edge.to)?.text}</Button
      >
    {/each}
  </div>
{/if}
