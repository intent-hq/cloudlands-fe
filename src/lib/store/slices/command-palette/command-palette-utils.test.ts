/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import {
  fuzzyScore,
  formatRelativeTime,
  parseQueryFilter,
  buildNoteBreadcrumbs,
  buildRecentItems,
  type WorkspaceObject,
} from "./command-palette-utils";
import type { Note } from "$shared/types";

// ── fuzzyScore ─────────────────────────────────────────────────────────────

describe("fuzzyScore", () => {
  it("returns 0 for empty needle", () => {
    expect(fuzzyScore("hello", "")).toBe(0);
  });

  it("returns 1000 for exact match", () => {
    expect(fuzzyScore("hello", "hello")).toBe(1000);
  });

  it("returns high score for prefix match", () => {
    const score = fuzzyScore("hello world", "hello");
    expect(score).toBeGreaterThan(100);
  });

  it("returns -Infinity for non-subsequence", () => {
    expect(fuzzyScore("abc", "xyz")).toBe(-Infinity);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("Hello", "hello")).toBe(1000);
  });

  it("scores word-boundary matches higher", () => {
    const boundaryScore = fuzzyScore("my-file-name", "mfn");
    const midScore = fuzzyScore("amfnxyz", "mfn");
    expect(boundaryScore).toBeGreaterThan(midScore);
  });
});
// ── parseQueryFilter ───────────────────────────────────────────────────────

describe("parseQueryFilter", () => {
  it("returns null filter for empty query", () => {
    expect(parseQueryFilter("")).toEqual({ filter: null, searchTerm: "" });
  });

  it("detects @ prefix as agent filter", () => {
    expect(parseQueryFilter("@search")).toEqual({ filter: "agent", searchTerm: "search" });
  });

  it("detects # prefix as note filter", () => {
    expect(parseQueryFilter("# my note")).toEqual({ filter: "note", searchTerm: "my note" });
  });

  it("returns null filter for normal text", () => {
    expect(parseQueryFilter("hello")).toEqual({ filter: null, searchTerm: "hello" });
  });

  it("detects all prefix types", () => {
    expect(parseQueryFilter(">cmd").filter).toBe("terminal");
    expect(parseQueryFilter("~diff").filter).toBe("change");
    expect(parseQueryFilter("/path").filter).toBe("file");
    expect(parseQueryFilter("*ws").filter).toBe("workspace");
    expect(parseQueryFilter("^url").filter).toBe("browser");
  });
});

// ── formatRelativeTime ─────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  it("returns empty string for undefined", () => {
    expect(formatRelativeTime(undefined)).toBe("");
  });

  it("returns 'just now' for recent timestamps", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("just now");
  });

  it("returns minutes ago for recent past", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });
});

// ── buildNoteBreadcrumbs ───────────────────────────────────────────────────

describe("buildNoteBreadcrumbs", () => {
  it("returns empty string for root note", () => {
    const note = { id: "n1", title: "Root" } as Note;
    expect(buildNoteBreadcrumbs(note, [note])).toBe("");
  });

  it("builds parent chain", () => {
    const parent = { id: "p1", title: "Parent" } as Note;
    const child = { id: "c1", title: "Child", parentId: "p1" } as Note;
    expect(buildNoteBreadcrumbs(child, [parent, child])).toBe("Parent");
  });

  it("builds multi-level chain", () => {
    const gp = { id: "gp", title: "Grandparent" } as Note;
    const p = { id: "p", title: "Parent", parentId: "gp" } as Note;
    const c = { id: "c", title: "Child", parentId: "p" } as Note;
    expect(buildNoteBreadcrumbs(c, [gp, p, c])).toBe("Grandparent / Parent");
  });
});

// ── buildRecentItems ───────────────────────────────────────────────────────

describe("buildRecentItems", () => {
  it("returns empty when no MRU data", () => {
    const objects: WorkspaceObject[] = [
      { id: "a1", type: "agent", label: "Agent 1", icon: null },
    ];
    expect(buildRecentItems(objects, [])).toEqual([]);
  });

  it("matches MRU entries to workspace objects", () => {
    const objects: WorkspaceObject[] = [
      { id: "a1", type: "agent", label: "Agent 1", icon: null },
    ];
    const recent = buildRecentItems(objects, [{ type: "agent", id: "a1", timestamp: 100 }]);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("a1");
  });

  it("skips stale MRU entries before capping recent items", () => {
    const objects: WorkspaceObject[] = [
      { id: "a1", type: "agent", label: "Agent 1", icon: null },
      { id: "a2", type: "agent", label: "Agent 2", icon: null },
      { id: "a3", type: "agent", label: "Agent 3", icon: null },
    ];
    const recent = buildRecentItems(objects, [
      { type: "agent", id: "missing", timestamp: 400 },
      { type: "agent", id: "a1", timestamp: 300 },
      { type: "agent", id: "a2", timestamp: 200 },
      { type: "agent", id: "a3", timestamp: 100 },
    ]);

    expect(recent.map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
  });
});

