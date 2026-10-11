import { expect } from "@playwright/test";

// Independent negative-case oracle from the pinned Svelte workbench fixture.
// The engine and fixture are source-fingerprinted; a changed diagnostic needs review.
const source = "flowchart LR\n  A[Missing close --> B[Invalid";
const diagnostic =
  "Parse error on line 2:\n...[Missing close --> B[Invalid\n-----------------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', 'PIPE', 'CYLINDEREND', 'DIAMOND_STOP', 'TAGEND', 'TRAPEND', 'INVTRAPEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'SQS'";

function isFixtureDiagnostic(message) {
  const match = message.match(
    /^console: \[[^\]\r\n]+\] \[ERROR\] \[MermaidRenderer\] Failed to render mermaid diagram: (\{"error":.*\}) \{error: Object\}$/,
  );
  if (!match) return false;
  try {
    const { error } = JSON.parse(match[1]);
    return error?.name === "Error" && error.message === diagnostic;
  } catch {
    return false;
  }
}

export async function inspectWorkbenchError(page, browserErrors) {
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
    isFixtureDiagnostic(message) ? [{ message, index }] : [],
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
  };
}
