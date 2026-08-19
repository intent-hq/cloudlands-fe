import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(process.cwd(), 'src/app.html'), 'utf8');

describe('pre-hydration splash art', () => {
  it('renders semantic Truchet lines without visible loading text', () => {
    expect(source).not.toContain('splash-text');
    expect(source).not.toContain('Getting ready to build');
    expect(source).toContain('id="splash-art"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("token('--foreground'");
    expect(source).not.toContain('dark ? 0.14 : 0.09');
    expect(source).not.toContain("token('--info'");
    expect(source).toMatch(/html,\s*body,\s*#app\s*{\s*background: transparent;/);
    expect(source).toContain('background: transparent');
    expect(source).toContain('context.clearRect(0, 0, width, height)');
    expect(source).not.toContain('context.fillRect(0, 0, width, height)');
    expect(source).not.toContain("context.globalCompositeOperation = 'destination-out'");
    expect(source).toContain("context.globalCompositeOperation = 'source-over'");
    expect(source).not.toContain('Math.min(cellWidth, cellHeight) * 0.14');
    expect(source).toContain('context.lineWidth = 2');
    expect(source).toContain('const initialRevealProgress = 0.12');
    expect(source).toContain('initialRevealProgress +');
    expect(source).not.toContain('padding: 16px');
    expect(source).not.toContain('border-radius: 20px');
    expect(source).not.toContain("token('--primary'");
    expect(source).not.toContain("context.createPattern(grainCanvas, 'repeat')");
  });

  it('draws every connected line forward once across tile segments', () => {
    expect(source).toContain('Math.round(width / 150)');
    expect(source).toContain('function traceRoute(startIndex, startPort)');
    expect(source).toContain('function longestRouteForLayout()');
    expect(source).toContain('function buildFullWindowRoute()');
    expect(source).toContain('coverage.columnsCovered === columns');
    expect(source).toContain('coverage.rowsCovered === rows');
    expect(source).toContain('function buildAllRoutes()');
    expect(source).toContain('candidate.totalLength = offset');
    expect(source).toContain('function strokeRoute(route, progress)');
    expect(source).toContain('for (const route of routes)');
    expect(source).toContain('Math.min(1, traveled / route.totalLength)');
    expect(source).not.toContain('% (halfCycle * 2)');
    expect(source).not.toContain('waveProgress');
    expect(source).not.toContain('revealRadius');
    expect(source).not.toContain('segment.delay');
    expect(source).not.toContain('function drawSegment');
    expect(source).not.toContain('function drawTraveler');
  });

  it('renders seven fine concentric curves per tile without breaking routed reveals', () => {
    expect(source).toContain('const curvesPerTile = 7');
    expect(source).toContain('const curveSpacing = 0.12');
    expect(source).toContain('context.lineWidth = 2');
    expect(source).toContain('function curveRadius(halfExtent, curveIndex)');
    expect(source).toContain('curveIndex - (curvesPerTile - 1) / 2');
    expect(source).toContain('halfExtent * (1 + centeredIndex * curveSpacing)');
    expect(source).not.toContain('(halfExtent * 2 * (curveIndex + 1)) / (curvesPerTile + 1)');
    expect(source).toContain('pointOnSegment(segment, localStart, curveIndex)');
    expect(source).toContain('function addTileCurve(cx, cy, rx, ry, startAngle, endAngle)');
    expect(source.match(/curveIndex < curvesPerTile/g)).toHaveLength(2);
    expect(source).toContain('strokeRoute(route, Math.min(1, traveled / route.totalLength))');
  });

  it('switches to interactive Truchet flips after the intro', () => {
    expect(source).toContain('function drawInteractiveTiles(now)');
    expect(source).toContain('tile.orient ^= 1');
    expect(source).toContain(
      'context.rect(tile.cx - tile.rx, tile.cy - tile.ry, tile.rx * 2, tile.ry * 2)',
    );
    expect(source.match(/context\.clip\(\)/g)).toHaveLength(1);
    expect(source).toContain("canvas.addEventListener('pointermove'");
    expect(source).toContain("canvas.addEventListener('pointerdown'");
    expect(source).toContain('nextAmbientFlip = now + 1100');
  });

  it('respects reduced motion and stops drawing after splash cleanup', () => {
    expect(source).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(source).toContain('if (!canvas.isConnected) return;');
    expect(source).toContain('if (!reducedMotion) requestAnimationFrame(draw);');
    expect(source).toContain('const introProgress = reducedMotion');
  });
});
