import { describe, expect, it } from "vitest";

import { isEventInFamily, isEventOneOf } from "./live-support";

// The daemon wraps each domain event as `{ event: { type, … } }` (PROTOCOL §7
// notification envelope; mirrors extractEvent in daemon-events-bridge.ts).
// These tests pin the family/type matchers to that envelope so an unrelated
// notification (e.g. terminal:data from PTY traffic) does NOT match the git /
// changes / file families. Flat legacy payloads keep working, and a truly
// typeless payload still defensively matches.

describe("isEventInFamily (wrapped envelope)", () => {
  it("does NOT match git/changes/file for a wrapped terminal:data event", () => {
    const params = { event: { type: "terminal:data", data: { chunk: "x" } } };
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
    expect(isEventInFamily("events.event", params, "changes")).toBe(false);
    expect(isEventInFamily("events.event", params, "file")).toBe(false);
  });

  it("matches the git family for a wrapped git:commit event", () => {
    const params = { event: { type: "git:commit", data: {} }, subscriptionId: "s-1" };
    expect(isEventInFamily("events.event", params, "git")).toBe(true);
    expect(isEventInFamily("events.event", params, "changes")).toBe(false);
  });

  it("matches the changes family for a wrapped changes:git-status event", () => {
    const params = { event: { type: "changes:git-status" } };
    expect(isEventInFamily("events.event", params, "changes")).toBe(true);
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
  });

  it("matches the file family for a wrapped file:changed event", () => {
    const params = { event: { type: "file:changed" } };
    expect(isEventInFamily("events.event", params, "file")).toBe(true);
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
  });
});

describe("isEventInFamily (flat legacy payload)", () => {
  it("still matches a flat {type:'git:commit'}", () => {
    expect(isEventInFamily("events.event", { type: "git:commit" }, "git")).toBe(true);
    expect(isEventInFamily("events.event", { type: "git:commit" }, "changes")).toBe(false);
  });

  it("does NOT match unrelated flat types", () => {
    expect(isEventInFamily("events.event", { type: "terminal:data" }, "git")).toBe(false);
  });
});

describe("isEventInFamily (typeless / non-events methods)", () => {
  it("returns false for non-'events.event' methods", () => {
    expect(isEventInFamily("notes.subscribe", { event: { type: "git:commit" } }, "git")).toBe(false);
  });

  it("defensively matches truly typeless payloads (no event, no type)", () => {
    expect(isEventInFamily("events.event", {}, "git")).toBe(true);
    expect(isEventInFamily("events.event", { event: {} }, "git")).toBe(true);
    expect(isEventInFamily("events.event", undefined, "git")).toBe(true);
  });
});

describe("isEventOneOf (wrapped envelope)", () => {
  const AGENT_TYPES = ["agent:created", "agent:status"] as const;

  it("matches only the listed types from a wrapped envelope", () => {
    expect(
      isEventOneOf("events.event", { event: { type: "agent:created" } }, AGENT_TYPES),
    ).toBe(true);
    expect(
      isEventOneOf("events.event", { event: { type: "agent:status" } }, AGENT_TYPES),
    ).toBe(true);
  });

  it("does NOT match a wrapped terminal:data event", () => {
    expect(
      isEventOneOf("events.event", { event: { type: "terminal:data" } }, AGENT_TYPES),
    ).toBe(false);
  });

  it("still matches flat legacy {type:…} payloads", () => {
    expect(isEventOneOf("events.event", { type: "agent:created" }, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf("events.event", { type: "terminal:data" }, AGENT_TYPES)).toBe(false);
  });

  it("defensively matches truly typeless payloads", () => {
    expect(isEventOneOf("events.event", {}, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf("events.event", { event: {} }, AGENT_TYPES)).toBe(true);
  });

  it("returns false for non-'events.event' methods", () => {
    expect(
      isEventOneOf("notes.subscribe", { event: { type: "agent:created" } }, AGENT_TYPES),
    ).toBe(false);
  });
});
