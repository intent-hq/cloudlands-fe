import { expect } from "@playwright/test";
import { endpoint } from "./manifest.mjs";

export async function openRecipe(page, title) {
  const base = endpoint(process.env.PARITY_CANDIDATE_URL, "PARITY_CANDIDATE_URL");
  const response = await page.goto(`${base}/sandbox/recipes?theme=light&motion=reduced&width=420`);
  expect(response?.ok()).toBe(true);
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await expect(section).toBeVisible({ timeout: 15_000 });
  return section;
}
