/**
 * Single source of truth for the per-slot micro key-slot palette shared by
 * `MicroKeySlotSquare.svelte` (base tint) and `MicroKeySlotBadge.svelte`
 * (hover tint). Both arrays are index-aligned (0-based slot → classes) so the
 * hover shade always deepens the matching base hue: red/rose, orange/amber,
 * yellow, green/emerald, blue/sky, purple/violet.
 *
 * Every Tailwind class is a static string literal (JIT-safe) — never
 * construct class names at runtime. Dependency-light on purpose: no stores,
 * services, or side effects.
 */

/**
 * Pastel rainbow base classes. Soft translucent backgrounds/borders work in
 * both themes; the text shade flips for dark mode.
 */
const SLOT_COLOR_CLASSES = [
  'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'border-yellow-500/30 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300',
];

/** Hover classes that deepen the matching base tint (same hue order). */
const SLOT_HOVER_CLASSES = [
  'hover:bg-rose-500/25',
  'hover:bg-amber-500/25',
  'hover:bg-yellow-500/25',
  'hover:bg-emerald-500/25',
  'hover:bg-sky-500/25',
  'hover:bg-violet-500/25',
];

/**
 * Base tint classes for a resolved 0-based slot (cycles past the palette
 * length; `slot` is always non-negative).
 */
export function slotColorClasses(slot: number): string {
  return SLOT_COLOR_CLASSES[slot % SLOT_COLOR_CLASSES.length];
}

/**
 * Hover tint classes for a resolved 0-based slot (cycles past the palette
 * length; `slot` is always non-negative).
 */
export function slotHoverClasses(slot: number): string {
  return SLOT_HOVER_CLASSES[slot % SLOT_HOVER_CLASSES.length];
}
