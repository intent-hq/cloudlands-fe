/**
 * Wire-contract tests for the prompt-enhance / AI-layout seam (PROTOCOL §5.31).
 *
 * Regression: prompt enhancement and AI layout generation spawned a local
 * auggie CLI through the unbridged `agent:enhance-prompt` /
 * `agent:generate-layout` Electron IPC handlers. Asserts the exact
 * `agent.enhancePrompt` JSON-RPC request for both modes, that the §5.31 result
 * envelope is returned verbatim, and that daemon errors propagate to callers
 * (no silent fallback to the original prompt).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "./backend-transport";
import {
  enhancePrompt,
  generateLayout,
  isEnhancePromptAvailable,
  EnhancePromptUnavailableError,
} from "./live-prompt-enhancement";

const mockedRequest = vi.mocked(backendRequest);

describe("live prompt-enhancement seam (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("enhancePrompt sends mode 'enhance' with model and returns the §5.31 envelope verbatim", async () => {
    const envelope = {
      enhanced: "Improve the login flow: add client-side validation …",
      original: "make login better",
      mode: "enhance" as const,
    };
    mockedRequest.mockResolvedValueOnce(envelope);

    const result = await enhancePrompt("make login better", { model: "haiku4.5" });

    expect(mockedRequest).toHaveBeenCalledWith("agent.enhancePrompt", {
      prompt: "make login better",
      mode: "enhance",
      model: "haiku4.5",
    });
    expect(result).toEqual(envelope);
  });

  it("enhancePrompt omits model/workspaceId when not provided (daemon defaults apply)", async () => {
    mockedRequest.mockResolvedValueOnce({
      enhanced: "Enhanced",
      original: "raw",
      mode: "enhance",
    });

    await enhancePrompt("raw");

    expect(mockedRequest).toHaveBeenCalledWith("agent.enhancePrompt", {
      prompt: "raw",
      mode: "enhance",
    });
  });

  it("generateLayout sends the instruction verbatim with mode 'layout', workspaceId and model", async () => {
    const envelope = {
      enhanced: '{"type":"single","panels":[{"tabs":[]}]}',
      original: "layout instruction",
      mode: "layout" as const,
    };
    mockedRequest.mockResolvedValueOnce(envelope);

    const result = await generateLayout("layout instruction", {
      workspaceId: "ws-abc",
      model: "haiku4.5",
    });

    expect(mockedRequest).toHaveBeenCalledWith("agent.enhancePrompt", {
      prompt: "layout instruction",
      mode: "layout",
      model: "haiku4.5",
      workspaceId: "ws-abc",
    });
    expect(result).toEqual(envelope);
  });

  it("propagates daemon errors (CLI not found / timeout) instead of falling back silently", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("auggie CLI not found"));
    await expect(enhancePrompt("raw")).rejects.toThrow("auggie CLI not found");

    mockedRequest.mockRejectedValueOnce(new Error("enhancement timed out after 30000ms"));
    await expect(generateLayout("layout instruction")).rejects.toThrow(
      "enhancement timed out after 30000ms",
    );
  });

  it("enhancePrompt throws EnhancePromptUnavailableError on the §5.31 { available: false } gate", async () => {
    // Canonical gated payload from the daemon's provider-neutrality gate
    // (wss_agent_enhance_prompt_unavailable_when_provider_not_auggie).
    const reason = "enhance-prompt requires auggie as the active provider";
    mockedRequest.mockResolvedValueOnce({ available: false, reason });

    const pending = enhancePrompt("ship it");
    await expect(pending).rejects.toBeInstanceOf(EnhancePromptUnavailableError);
    await pending.catch((error: EnhancePromptUnavailableError) => {
      expect(error.reason).toBe(reason);
      expect(error.message).toBe(reason);
    });
    expect(mockedRequest).toHaveBeenCalledWith("agent.enhancePrompt", {
      prompt: "ship it",
      mode: "enhance",
    });
  });

  it("generateLayout throws EnhancePromptUnavailableError on the §5.31 { available: false } gate", async () => {
    const reason = "enhance-prompt requires auggie as the active provider";
    mockedRequest.mockResolvedValueOnce({ available: false, reason });

    const pending = generateLayout("layout instruction", { workspaceId: "ws-abc" });
    await expect(pending).rejects.toBeInstanceOf(EnhancePromptUnavailableError);
    await pending.catch((error: EnhancePromptUnavailableError) => {
      expect(error.reason).toBe(reason);
    });
    expect(mockedRequest).toHaveBeenCalledWith("agent.enhancePrompt", {
      prompt: "layout instruction",
      mode: "layout",
      workspaceId: "ws-abc",
    });
  });

  it("isEnhancePromptAvailable gates on the settings-derived effective provider (auggie only)", () => {
    // The daemon no longer treats an unset `providers.active` as auggie —
    // the FE mirror hides the affordance unless the settings-derived
    // effective provider resolves to auggie.
    expect(isEnhancePromptAvailable("auggie")).toBe(true);
    expect(isEnhancePromptAvailable("codex")).toBe(false);
    expect(isEnhancePromptAvailable("")).toBe(false);
    expect(isEnhancePromptAvailable(null)).toBe(false);
    expect(isEnhancePromptAvailable(undefined)).toBe(false);
  });
});
