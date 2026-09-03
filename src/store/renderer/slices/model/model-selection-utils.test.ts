import {
  describe,
  expect,
  it,
} from "vitest";
import {
  resolveDefaultModel,
  toBareProviderModels,
} from "./model-selection-utils";

const defaultProviderId = "auggie";

describe("model-selection-utils", () => {
  it("splits legacy compound values down to bare model ids", () => {
    expect(
      toBareProviderModels({
        [defaultProviderId]: `${defaultProviderId}:gpt5.4`,
        codex: "codex:gpt-5.3-codex/high",
        "claude-code": "sonnet4.5",
      })
    ).toEqual({
      [defaultProviderId]: "gpt5.4",
      codex: "gpt-5.3-codex/high",
      "claude-code": "sonnet4.5",
    });
  });

  it("resolves the CLI-marked default model and falls back to the first row", () => {
    expect(
      resolveDefaultModel([
        { value: "codex:gpt5.4" },
        { value: "codex:other", isDefault: true },
      ])
    ).toBe("codex:other");
    expect(
      resolveDefaultModel([{ value: "codex:other" }, { value: "codex:another" }])
    ).toBe("codex:other");
    expect(resolveDefaultModel([])).toBe("");
  });
});