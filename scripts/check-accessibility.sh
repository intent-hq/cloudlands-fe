#!/usr/bin/env bash
# check-accessibility.sh — Grep-based accessibility lint script
#
# Prevents regressions of small font sizes, low-opacity text, and hardcoded
# low-contrast colors in .svelte and .css files.
#
# What it checks:
#   1. Tiny font sizes: text-[8px] .. text-[12px] (Tailwind arbitrary)
#      Use text-ui, text-ui-sm, or text-xs instead.
#   2. CSS font-size <= 10px (inline styles / <style> blocks)
#   3. Opacity-modified text colors: text-muted-foreground/XX or text-foreground/XX
#      Use text-muted-foreground, text-ghost, or text-foreground instead.
#   4. Hardcoded low-contrast gray text: color: #888, #999, #aaa, #bbb, #ccc, etc.
#
# Allowlist:
#   - Inline: Add "a11y-ignore" anywhere on the line to suppress that violation
#   - Baseline: Create scripts/.a11y-baseline with file:line patterns to ignore
#     (one per line, e.g. "src/lib/components/CommandPalette.svelte:1131")
#     Run with --update-baseline to regenerate the baseline from current violations.
#
# Usage:
#   ./scripts/check-accessibility.sh              # check src/
#   ./scripts/check-accessibility.sh path/         # check specific directory
#   ./scripts/check-accessibility.sh --update-baseline  # snapshot current violations
#
# Exit codes:  0 = clean, 1 = new violations found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASELINE_FILE="$SCRIPT_DIR/.a11y-baseline"
UPDATE_BASELINE=false

if [ "${1:-}" = "--update-baseline" ]; then
  UPDATE_BASELINE=true
  SEARCH_DIR="${2:-src}"
else
  SEARCH_DIR="${1:-src}"
fi

VIOLATIONS=0
TMPFILE=$(mktemp)
ALLFILE=$(mktemp)
trap 'rm -f "$TMPFILE" "$ALLFILE"' EXIT

RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

filter_baseline() {
  if [ ! -f "$BASELINE_FILE" ] || [ "$UPDATE_BASELINE" = true ]; then
    cat
    return
  fi
  while IFS= read -r line; do
    local file_line
    file_line=$(echo "$line" | cut -d: -f1,2)
    if ! grep -qxF "$file_line" "$BASELINE_FILE"; then
      echo "$line"
    fi
  done
}

check_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2
  local found=0

  local results
  results=$(grep -rn --include='*.svelte' --include='*.css' -E "$pattern" "$SEARCH_DIR" 2>/dev/null \
    | grep -v 'a11y-ignore' \
    | grep -v 'check-accessibility' || true)

  for exclude in "$@"; do
    if [ -n "$results" ]; then
      results=$(echo "$results" | grep -v -E "$exclude" || true)
    fi
  done

  [ -z "$results" ] && return

  # Save all results for baseline
  echo "$results" >> "$ALLFILE"

  # Filter through baseline
  local filtered
  filtered=$(echo "$results" | filter_baseline || true)
  [ -z "$filtered" ] && return

  printf '%s' "$filtered" > "$TMPFILE"
  found=$(grep -c '' "$TMPFILE" || true)
  if [ "$found" -gt 0 ]; then
    echo -e "\n${RED}[$label]${NC} — $found violation(s):"
    while IFS= read -r line; do
      echo -e "  ${YELLOW}$line${NC}"
    done < "$TMPFILE"
    VIOLATIONS=$((VIOLATIONS + found))
  fi
}

echo -e "${CYAN}=== Accessibility Lint Check ===${NC}"
echo -e "Scanning: ${SEARCH_DIR}/"

# ── Rule 1: Tiny Tailwind font sizes (≤ 12px) ───────────────────────────────
check_pattern "Tiny font size (Tailwind)" 'text-\[(([0-9]|1[0-2])px)\]'

# ── Rule 2: CSS font-size <= 10px ────────────────────────────────────────────
check_pattern "Tiny font size (CSS)" 'font-size:[[:space:]]*(([0-9]|10)px)'

# ── Rule 3: Opacity-modified text colors ─────────────────────────────────────
# Flag ANY text-foreground/XX or text-muted-foreground/XX opacity pattern.
# Use text-muted-foreground, text-ghost, or text-foreground instead.
check_pattern "Opacity-modified text color" \
  'text-(muted-)?foreground/[0-9]' \
  'hover:text-|focus:text-|group-hover:text-' \
  'placeholder:' \
  '<Fa |<[A-Z][a-zA-Z]*Icon' \
  'cursor-not-allowed' \
  'bg-foreground/' \
  '<!--'

# ── Rule 4: Hardcoded low-contrast gray text colors ─────────────────────────
check_pattern "Hardcoded gray text color" \
  "color:[[:space:]]*#[89a-cA-C]{3}([0-9a-fA-F]{3})?[^0-9a-fA-F]"

# ── Baseline update mode ─────────────────────────────────────────────────────
if [ "$UPDATE_BASELINE" = true ]; then
  if [ -s "$ALLFILE" ]; then
    cut -d: -f1,2 < "$ALLFILE" | sort -u > "$BASELINE_FILE"
    count=$(wc -l < "$BASELINE_FILE" | tr -d ' ')
    echo -e "\n${CYAN}✓ Baseline updated: $count entries written to ${BASELINE_FILE}${NC}"
  else
    : > "$BASELINE_FILE"
    echo -e "\n${CYAN}✓ Baseline cleared (no violations found).${NC}"
  fi
  exit 0
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo -e "${RED}✗ Found $VIOLATIONS new accessibility violation(s).${NC}"
  echo -e "  Fix the issue, or add ${CYAN}/* a11y-ignore */${NC} on the line to suppress."
  [ -f "$BASELINE_FILE" ] && echo -e "  ${DIM}($(wc -l < "$BASELINE_FILE" | tr -d ' ') baselined violations hidden)${NC}"
  exit 1
else
  echo -e "${CYAN}✓ No new accessibility violations found.${NC}"
  [ -f "$BASELINE_FILE" ] && echo -e "  ${DIM}($(wc -l < "$BASELINE_FILE" | tr -d ' ') baselined violations hidden)${NC}"
  exit 0
fi

