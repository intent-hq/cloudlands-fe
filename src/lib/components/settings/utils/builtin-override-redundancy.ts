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
import type { FileSpecialist } from '$store/renderer/slices/specialists/specialists-slice';

/** Treat `undefined` and `''` as equal (both mean "not set" on the wire). */
function normalized(value: string | undefined): string {
  return value ?? '';
}

/**
 * True when a user-scope override of a built-in specialist is redundant:
 * `name`, `description`, `behaviorPrompt` (vs `defaultBehaviorPrompt`), and
 * `roleReminder` all match the bundled definition, and no explicit model pin
 * remains. Pass `ignoreModelPin: true` when the pin is about to be cleared
 * (reset paths) to classify what the file becomes after clearing.
 *
 * `codingAgent` is intentionally ignored: it is only ever written as a side
 * effect of a model pin (the provider parsed from the compound model id) or
 * baked as a copy of the effective default on other saves — never chosen
 * independently by the user — so it carries no customization intent.
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
  if (!options?.ignoreModelPin && fileSpec.model) return false;
  const bundled = bundledSpecialists.find((s) => s.id === fileSpec.id);
  if (!bundled) return false;
  return (
    normalized(fileSpec.name) === normalized(bundled.name) &&
    normalized(fileSpec.description) === normalized(bundled.description) &&
    normalized(fileSpec.behaviorPrompt) === normalized(bundled.defaultBehaviorPrompt) &&
    normalized(fileSpec.roleReminder) === normalized(bundled.roleReminder)
  );
}
