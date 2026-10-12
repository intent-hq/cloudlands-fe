import { mount, tick, unmount } from "svelte";
import Host from "/src/features/agent/components/agent-avatar/__tests__/AgentAvatarWaitingHost.svelte";
import "/src/app.css";
import "@fontsource-variable/inter/index.css";
import provenance from "virtual:agent-avatar-source-provenance";

// Only the first reviewed comparison is enabled. New cases require explicit review.
const expected = { theme: "light", motion: "reduced", state: "waiting", zoom: "1" };
const query = new URLSearchParams(location.search);
for (const [key, value] of query) {
  if (!Object.hasOwn(expected, key) || query.getAll(key).length !== 1 || value !== expected[key]) {
    throw new Error(`Unreviewed avatar source parameter: ${key}.`);
  }
}
const props = { theme: "light", state: "waiting", zoom: 1, motionReduced: true };
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  throw new Error("The avatar source fixture requires a reduced-motion browser context.");
}

// Exact font setup from the pinned sandbox layout and test/test-fonts.ts.
document.documentElement.classList.add("light");
document.documentElement.style.setProperty(
  "--font-ui",
  "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
);
document.body.style.fontFamily = "var(--font-ui)";
const target = document.getElementById("agent-avatar-source");
const component = mount(Host, { target, props });
addEventListener("pagehide", () => void unmount(component), { once: true });
await tick();
const descriptors = [400, 500, 600].map((weight) => `${weight} 12px 'Inter Variable'`);
await Promise.all(descriptors.map((descriptor) => document.fonts.load(descriptor)));
await document.fonts.ready;
const fonts = Array.from(document.fonts)
  .filter((face) => face.family.trim().replace(/^["']|["']$/g, "") === "Inter Variable")
  .map((face) => ({
    family: face.family,
    status: face.status,
    weight: face.weight,
    style: face.style,
  }));
if (!fonts.some((face) => face.status === "loaded")) {
  throw new Error("The pinned Inter Variable font did not load; source capture is unavailable.");
}
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const host = target.firstElementChild;
if (!host || target.children.length !== 1 || !host.querySelector("[data-agent-avatar-catalog]")) {
  throw new Error("The unchanged avatar source host did not mount its catalog.");
}
// Mark the real host after readiness; no wrapper geometry or component styles are added.
host.dataset.testid = "source-avatar-waiting-host";
target.dataset.avatarSourceReady = "true";
window.__INTENT_AVATAR_SOURCE__ = Object.freeze({
  status: "ready",
  provenance,
  props,
  fonts,
  fontDescriptors: descriptors,
  crop: '[data-testid="source-avatar-waiting-host"]',
});
