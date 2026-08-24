import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(
  resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
  'utf8',
);
const softeningLayer = readFileSync(
  resolve(process.cwd(), 'src/lib/components/chat/AuroraSofteningLayer.svelte'),
  'utf8',
);

describe('composer Aurora softening layer', () => {
  it('orders the canvas, softening layer, and sharp prompt foreground', () => {
    const host = panel.indexOf('data-testid="composer-aurora-host"');
    const canvas = panel.indexOf('<AuroraBackground {agentId} />', host);
    const softening = panel.indexOf('<AuroraSofteningLayer />', canvas);
    const prompt = panel.indexOf('data-testid="composer-prompt-layer"', softening);

    expect(host).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(host);
    expect(softening).toBeGreaterThan(canvas);
    expect(prompt).toBeGreaterThan(softening);
    expect(panel).toContain('class="composer-prompt-layer relative z-10 w-full"');
    expect(panel).toContain(
      'class="composer-aurora-host pointer-events-none absolute -left-4 -right-2 -bottom-4 z-0 overflow-hidden"',
    );
    expect(panel).toContain(
      'class="composer-aurora-host absolute inset-x-0 bottom-0 z-0 overflow-hidden rounded-lg"',
    );
    expect(panel).toContain('class="pointer-events-none absolute inset-y-0 left-0 z-0"');
    expect(panel).toContain('style:right="{scrollbarGutterWidth}px"');
    expect(panel).toContain('class:chief-composer={isChiefWorkspace}');
    expect(panel).not.toContain('class:pb-3={!hasVisibleTranscriptUtility}');
    expect(softeningLayer).toContain('aria-hidden="true"');
    expect(softeningLayer).toContain('aurora-softening-layer pointer-events-none');
  });

  it('uses a smooth bottom-up mask only when masked backdrop blur is supported', () => {
    expect(softeningLayer).toContain('@supports ((backdrop-filter: blur(1px)) and (mask-image:');
    expect(softeningLayer).toContain('backdrop-filter: blur(18px) saturate(0.9)');
    expect(softeningLayer).toContain('transparent 0%');
    expect(softeningLayer).toContain('rgb(0 0 0 / 0.06) 26%');
    expect(softeningLayer).toContain('rgb(0 0 0 / 0.64) 72%');
    expect(softeningLayer).toContain('black 100%');
  });

  it('keeps a theme-aware gradient fallback outside the support query', () => {
    const fallback = softeningLayer.indexOf('.aurora-softening-layer {');
    const support = softeningLayer.indexOf('@supports', fallback);
    const fallbackRule = softeningLayer.slice(fallback, support);

    expect(fallbackRule).toContain('linear-gradient(');
    expect(fallbackRule).toContain('hsl(var(--background) / 0.72) 100%');
    expect(fallbackRule).not.toContain('backdrop-filter');
    expect(fallbackRule).not.toContain('mask-image');
  });
});
