import { describe, expect, it } from "vitest";
import { getDefaultProviderId } from "$shared/config/provider-config";
import {
  findAvailableModelMatch,
  normalizeModelForProvider,
  normalizeProviderModels,
  resolvePreferredModelForProvider,
} from "./model-selection-utils";

const defaultProviderId = getDefaultProviderId();

describe("model-selection-utils", () => {
  it("normalizes models for the default and non-default providers", () => {
    expect(normalizeModelForProvider(defaultProviderId, `${defaultProviderId}:gpt5.4`)).toBe(
      "gpt5.4"
    );
    expect(normalizeModelForProvider("codex", "gpt-5.3-codex/high")).toBe(
      "codex:gpt-5.3-codex/high"
    );
  });

  it("normalizes provider model maps", () => {
    expect(
      normalizeProviderModels({
        [defaultProviderId]: `${defaultProviderId}:gpt5.4`,
        codex: "gpt-5.3-codex/high",
      })
    ).toEqual({
      [defaultProviderId]: "gpt5.4",
      codex: "codex:gpt-5.3-codex/high",
    });
  });

  it("matches available values by full ID or parsed model ID", () => {
    const availableValues = ["codex:gpt-5.3-codex/high", "codex:gpt-5.3-codex/medium"];

    expect(findAvailableModelMatch(availableValues, "codex", "gpt-5.3-codex/high")).toBe(
      "codex:gpt-5.3-codex/high"
    );
    expect(findAvailableModelMatch(availableValues, "codex", "gpt-5.3-codex/medium")).toBe(
      "codex:gpt-5.3-codex/medium"
    );
  });

  it("resolves the first preferred available model and falls back to the first item", () => {
    expect(resolvePreferredModelForProvider(["codex:gpt5.4", "codex:other"])).toBe(
      "codex:gpt5.4"
    );
    expect(resolvePreferredModelForProvider(["codex:other", "codex:another"])).toBe(
      "codex:other"
    );
    expect(resolvePreferredModelForProvider([])).toBeUndefined();
  });
});