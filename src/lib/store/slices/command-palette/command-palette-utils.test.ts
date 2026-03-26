/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  fuzzyScore,
  formatRelativeTime,
  parseQueryFilter,
  buildNoteBreadcrumbs,
  buildRecentItems,
  getMRUEntries,
  saveMRUEntries,
  recordMRUItem,
  type WorkspaceObject,
} from "./command-palette-utils";
import { computeResults, type ComputeResultsInput } from "./command-palette-results";
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

// ── MRU helpers ────────────────────────────────────────────────────────────

describe("MRU helpers", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    // Override the vi.fn() mocks from test-setup with working implementations
    vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => store[key] ?? null);
    vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => { store[key] = value; });
    vi.spyOn(localStorage, "removeItem").mockImplementation((key: string) => { delete store[key]; });
    vi.spyOn(localStorage, "clear").mockImplementation(() => { store = {}; });
  });

  it("getMRUEntries returns empty array when no data", () => {
    expect(getMRUEntries()).toEqual([]);
  });

  it("saveMRUEntries + getMRUEntries round-trips", () => {
    const entries = [{ type: "agent" as const, id: "a1", timestamp: 100 }];
    saveMRUEntries(entries);
    expect(getMRUEntries()).toEqual(entries);
  });

  it("recordMRUItem adds to front and deduplicates", () => {
    recordMRUItem("agent", "a1");
    recordMRUItem("note", "n1");
    recordMRUItem("agent", "a1"); // duplicate
    const entries = getMRUEntries();
    expect(entries[0].id).toBe("a1");
    expect(entries[1].id).toBe("n1");
    expect(entries.length).toBe(2);
  });
});

// ── buildRecentItems ───────────────────────────────────────────────────────

describe("buildRecentItems", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => store[key] ?? null);
    vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => { store[key] = value; });
  });

  it("returns empty when no MRU data", () => {
    const objects: WorkspaceObject[] = [
      { id: "a1", type: "agent", label: "Agent 1", icon: null },
    ];
    expect(buildRecentItems(objects)).toEqual([]);
  });

  it("matches MRU entries to workspace objects", () => {
    saveMRUEntries([{ type: "agent", id: "a1", timestamp: 100 }]);
    const objects: WorkspaceObject[] = [
      { id: "a1", type: "agent", label: "Agent 1", icon: null },
    ];
    const recent = buildRecentItems(objects);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("a1");
  });
});

