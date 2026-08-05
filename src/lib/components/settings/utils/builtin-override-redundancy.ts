/**
 * Redundancy check for user-scope overrides of built-in specialists.
 *
 * A built-in must never read as "Modified" when its override file is (or
 * becomes) identical to the bundled defaults (monorepo#1450). This util
 * decides whether such an override is redundant so callers can delete the
 * file (reset paths) or suppress the Modified indicators (badge/banner).
 *
 * Dependency-light on purpose: bundled specialists are passed in as a
 * parameter — no store or selector imports.
 */
import type { Specialist } from '$lib/constants/specialists';
import type { SpecialistModelOption } from '$shared/specialist-file-types';
import type { FileSpecialist } from '$store/renderer/slices/specialists/specialists-slice';

/** Treat `undefined` and `''` as equal (both mean "not set" on the wire). */
function normalized(value: string | undefined): string {
  return value ?? '';
}

/**
 * Ordered equality for `modelOptions` lists; `undefined` and `[]` compare
 * equal (both mean "no options" — the wire omits empty lists, PROTOCOL §5.11).
 */
function modelOptionsEqual(
  a: SpecialistModelOption[] | undefined,
  b: SpecialistModelOption[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((opt, i) => opt.model === right[i].model && opt.hint === right[i].hint)
  );
}

/**
 * True when a user-scope override of a built-in specialist is redundant:
 * `name`, `description`, `behaviorPrompt` (vs `defaultBehaviorPrompt`), and
 * `roleReminder` all match the bundled definition, and no explicit model pin
 * remains. Pass `ignoreModelPin: true` when the pin is about to be cleared
 * (reset paths) to classify what the file becomes after clearing.
 *
 * A non-empty `codingAgent` counts as a pin too (unless `ignoreModelPin`):
 * per PROTOCOL §5.11 inherit-on-omit, a `codingAgent` in a user-tier file
 * overrides the effective provider independently of the model pin
 * (`selectEffectiveCodingAgent` honors it), and legacy files may carry a
 * baked `codingAgent` with no `model:` key. Ignoring it on the badge path
 * would hide the Modified indicators — and the per-specialist Reset
 * affordance — for a file that still pins the provider. The reset/delete
 * paths pass `ignoreModelPin: true` and physically delete the file, which
 * removes the stale `codingAgent` along with the pin.
 *
 * Bundled `name`/`description` are i18n getters; comparing via property
 * access evaluates them to the current locale's values.
 */
export function isRedundantBuiltInOverride(
  fileSpec: FileSpecialist,
  bundledSpecialists: Specialist[],
  options?: { ignoreModelPin?: boolean },
): boolean {
  if (fileSpec.source !== 'user') return false;
  if (!options?.ignoreModelPin && (fileSpec.model || fileSpec.codingAgent)) return false;
  const bundled = bundledSpecialists.find((s) => s.id === fileSpec.id);
  if (!bundled) return false;
  return (
    normalized(fileSpec.name) === normalized(bundled.name) &&
    normalized(fileSpec.description) === normalized(bundled.description) &&
    normalized(fileSpec.behaviorPrompt) === normalized(bundled.defaultBehaviorPrompt) &&
    normalized(fileSpec.roleReminder) === normalized(bundled.roleReminder) &&
    modelOptionsEqual(fileSpec.modelOptions, bundled.modelOptions)
  );
}
