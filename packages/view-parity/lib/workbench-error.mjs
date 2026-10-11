import { expect } from "@playwright/test";

// Independent negative-case oracle from the pinned Svelte workbench fixture.
// The engine and fixture are source-fingerprinted; a changed diagnostic needs review.
const source = "flowchart LR\n  A[Missing close --> B[Invalid";
const diagnostic =
  "Parse error on line 2:\n...[Missing close --> B[Invalid\n-----------------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', 'PIPE', 'CYLINDEREND', 'DIAMOND_STOP', 'TAGEND', 'TRAPEND', 'INVTRAPEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'SQS'";

function isFixtureDiagnostic(message, record) {
  if (record?.args?.length !== 2) return false;
  const [formatted, payload] = record.args;
  // The logger truncates its formatted string for long stacks. Inspect the real
  // structured argument, retaining the untouched string and exact error oracle.
  return (
    typeof formatted === "string" &&
    /^\[[^\]\r\n]+\] \[ERROR\] \[MermaidRenderer\] Failed to render mermaid diagram: \{"error":/.test(
      formatted,
    ) &&
    message === `console: ${formatted} {error: Object}` &&
    payload?.error?.name === "Error" &&
    payload.error.message === diagnostic
  );
}

export async function inspectWorkbenchError(page, browserErrors, consoleDiagnostics) {
  const fixture = page.locator('[data-diagram-case="mermaid-invalid-source"]');
  await expect(fixture).toHaveCount(1);
  await fixture.scrollIntoViewIfNeeded();
  await expect(fixture.getByRole("alert")).toBeVisible();
  const renderer = fixture.locator("[data-render-generation]");
  const generation = await renderer.getAttribute("data-render-generation");
  expect(Number(generation)).toBeGreaterThan(0);
  await expect(renderer).toHaveAttribute("data-render-settled", "true");
  await expect(renderer).toHaveAttribute("data-render-settled-generation", generation);

  const details = fixture.locator("details");
  await expect(details).toHaveCount(1);
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  const errorText = details.locator(".error-message");
  const sourceText = details.locator(".error-source-code");
  await expect(errorText).toBeVisible();
  await expect(sourceText).toBeVisible();
  const observed = {
    source: await sourceText.textContent(),
    diagnostic: await errorText.textContent(),
  };
  expect(observed.source).toBe(source);
  expect(observed.diagnostic).toBe(diagnostic);

  const matches = browserErrors.flatMap((message, index) =>
    isFixtureDiagnostic(
      message,
      consoleDiagnostics.find((record) => record.index === index),
    )
      ? [{ message, index }]
      : [],
  );
  expect(matches, "Exactly one log must match this visible invalid source diagnostic").toHaveLength(
    1,
  );
  return {
    fixture: "mermaid-invalid-source",
    generation,
    observed,
    consumedIndex: matches[0].index,
    originalDiagnostic: matches[0].message,
    structuredDiagnostic: consoleDiagnostics.find((record) => record.index === matches[0].index),
  };
}
