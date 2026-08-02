/**
 * Live prompt-enhance / AI-layout seam backed by the intentd daemon
 * (`agent.enhancePrompt`, PROTOCOL §5.31).
 *
 * Replaces the FE's last local-CLI bypass — the `agent:enhance-prompt` /
 * `agent:generate-layout` Electron IPC handlers that spawned `auggie --print`
 * on the client. One-shot request/response: the daemon owns the enhancement
 * template, reply cleaning, and (in `enhance` mode) the
 * `<augment-enhanced-prompt>` extraction; the renderer sends the raw input.
 * Errors (CLI not found, timeout, parse failure) propagate as `BackendError`s
 * so callers surface them in the UI — there is no silent fallback to the
 * original prompt.
 */
import { backendRequest } from "./backend-transport";

/** §5.31 result envelope, returned verbatim by the daemon. */
export interface EnhancePromptResult {
  enhanced: string;
  original: string;
  mode: "enhance" | "layout";
}

/**
 * §5.31 provider-neutrality gate result: with a non-auggie active provider the
 * daemon returns `{ available: false, reason }` instead of an enhancement.
 */
interface EnhancePromptUnavailable {
  available: false;
  reason: string;
}

/**
 * Typed, catchable error for the §5.31 `{ available: false, reason }` gate —
 * thrown so callers surface the unavailable case (localized toast) instead of
 * assigning `undefined` into an input field.
 */
export class EnhancePromptUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "EnhancePromptUnavailableError";
    this.reason = reason;
  }
}

function isUnavailable(
  result: EnhancePromptResult | EnhancePromptUnavailable,
): result is EnhancePromptUnavailable {
  return "available" in result && result.available === false;
}

/**
 * FE mirror of the §5.31 provider gate: `agent.enhancePrompt` is auggie-only,
 * and the daemon treats an unset `providers.active` setting as auggie — so an
 * empty/null active provider keeps the affordance visible.
 */
export function isEnhancePromptAvailable(
  activeProviderId: string | null | undefined,
): boolean {
  return !activeProviderId || activeProviderId === "auggie";
}

export interface EnhancePromptOptions {
  /** Optional auggie model id (`--model`); omitted → CLI default. */
  model?: string;
  /** Optional workspace whose worktree becomes the CLI working directory. */
  workspaceId?: string;
}

function buildParams(
  prompt: string,
  mode: "enhance" | "layout",
  { model, workspaceId }: EnhancePromptOptions,
): Record<string, unknown> {
  return {
    prompt,
    mode,
    ...(model ? { model } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/** Enhance a raw user prompt (`mode: "enhance"` — daemon-side template + extraction). */
export async function enhancePrompt(
  prompt: string,
  options: EnhancePromptOptions = {},
): Promise<EnhancePromptResult> {
  const result = await backendRequest<EnhancePromptResult | EnhancePromptUnavailable>(
    "agent.enhancePrompt",
    buildParams(prompt, "enhance", options),
  );
  if (isUnavailable(result)) {
    throw new EnhancePromptUnavailableError(result.reason);
  }
  return result;
}

/** Run a layout-generation instruction verbatim (`mode: "layout"` — full cleaned reply). */
export async function generateLayout(
  prompt: string,
  options: EnhancePromptOptions = {},
): Promise<EnhancePromptResult> {
  const result = await backendRequest<EnhancePromptResult | EnhancePromptUnavailable>(
    "agent.enhancePrompt",
    buildParams(prompt, "layout", options),
  );
  if (isUnavailable(result)) {
    throw new EnhancePromptUnavailableError(result.reason);
  }
  return result;
}
