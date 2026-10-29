import { createProximityHover, type ProximityAxis, type ProximityHover } from '$lib/interaction';
import { untrack } from 'svelte';

interface ChoiceEntry {
  value: string;
  element: HTMLElement | null;
  disabled: boolean;
}

export class ChoiceGroupState {
  #entries = $state<Array<ChoiceEntry | undefined>>([]);
  #selectedValues: () => readonly string[];
  #axis: ProximityAxis;
  hover = $state<ProximityHover | null>(null);
  keyboardIndex = $state(0);

  constructor(selectedValues: () => readonly string[], axis: ProximityAxis) {
    this.#selectedValues = selectedValues;
    this.#axis = axis;
  }

  get selectedIndexes(): number[] {
    const selected = new Set(this.#selectedValues());
    return this.#entries.flatMap((entry, index) =>
      entry && selected.has(entry.value) ? [index] : [],
    );
  }

  allocate(value: string): number {
    return untrack(() => {
      const entry = { value, element: null, disabled: false };
      const free = this.#entries.indexOf(undefined);
      if (free < 0) return this.#entries.push(entry) - 1;
      this.#entries[free] = entry;
      return free;
    });
  }

  /** Frees a slot for reuse once its item unmounts; mounted items keep their indexes. */
  release(index: number): void {
    untrack(() => {
      if (!this.#entries[index]) return;
      this.#entries[index] = undefined;
      if (this.hover?.activeIndex === index) this.hover.setActiveIndex(null);
      this.hover?.registerItem(index, null);
    });
  }

  update(index: number, value: string, disabled: boolean): void {
    untrack(() => {
      const entry = this.#entries[index];
      if (entry) {
        entry.value = value;
        entry.disabled = disabled;
      }
    });
  }

  register(index: number, element: HTMLElement | null): void {
    untrack(() => {
      const entry = this.#entries[index];
      if (!entry) return;
      entry.element = element;
      this.hover?.registerItem(index, element);
    });
  }

  connect(element: HTMLElement): void {
    untrack(() => {
      this.hover?.destroy();
      this.hover = createProximityHover(element, { axis: this.#axis });
      for (const [index, entry] of this.#entries.entries()) {
        if (entry?.element) this.hover.registerItem(index, entry.element);
      }
    });
  }

  disconnect(): void {
    untrack(() => {
      this.hover?.destroy();
      this.hover = null;
    });
  }

  activate(index: number): void {
    this.keyboardIndex = index;
    this.hover?.setActiveIndex(index);
  }

  focusAdjacent(index: number, direction: 1 | -1): void {
    const enabled = this.#entries
      .map((entry, entryIndex) => ({ entry, entryIndex }))
      .filter(({ entry }) => entry?.element && !entry.disabled);
    const current = enabled.findIndex(({ entryIndex }) => entryIndex === index);
    if (current < 0 || enabled.length === 0) return;
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    this.activate(next.entryIndex);
    next.entry?.element?.focus();
  }
}
