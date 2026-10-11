import { test, expect } from "../lib/functional.mjs";
import { openRecipe } from "../lib/recipes.mjs";

test("recipe form: native required and custom validation precede trimmed submission", async ({
  page,
}) => {
  const recipe = await openRecipe(page, "Form with validation");
  const input = recipe.getByRole("textbox", { name: "Project name", exact: true });
  await recipe.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => el.validity.valueMissing)).toBe(true);
  await expect(recipe.locator("output")).toHaveText("Not submitted");
  await input.fill("ab");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(recipe.locator("output")).toHaveText("Not submitted");
  await input.fill("  Native project  ");
  await input.press("Enter");
  await expect(recipe.locator("output")).toHaveText("Created Native project");
});

test("recipe confirmation: Escape cancels and acceptance settles with opener focus", async ({
  page,
}) => {
  const recipe = await openRecipe(page, "Blocking confirm flow");
  const trigger = recipe.getByRole("button", { name: "Publish guide", exact: true });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(recipe.locator("output")).toHaveText("Cancelled");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(recipe.locator("output")).toHaveText("Published");
  await expect(trigger).toBeFocused();
});

test("recipe source: native disclosure and clipboard preserve the displayed code", async ({
  page,
  context,
}) => {
  const recipe = await openRecipe(page, "Form with validation");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  const summary = recipe.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(recipe.locator("pre")).toBeVisible();
  const displayed = await recipe.locator("code").textContent();
  expect(displayed.trim().length).toBeGreaterThan(0);
  await recipe.getByRole("button", { name: "Copy source", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
  await summary.press("Enter");
  await expect(recipe.locator("pre")).toBeHidden();
});
