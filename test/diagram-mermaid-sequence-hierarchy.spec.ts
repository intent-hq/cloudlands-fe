import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const appearances = ['light', 'dark', 'nord'] as const;
const widths = [320, 960] as const;

const contracts = {
  'mermaid-sequence-simple': {
    actors: ['Client', 'API'],
    messages: ['Submit account recovery request', 'Recovery request accepted'],
    patterns: ['solid', 'dashed'],
  },
  'mermaid-sequence-alt': {
    actors: ['Client', 'Service'],
    messages: ['Validate request', 'Accepted response', 'Explain required changes'],
    patterns: ['solid', 'dashed', 'dashed'],
  },
  'mermaid-sequence-loop': {
    actors: ['User', 'Workbench'],
    messages: ['Review rendered result', 'Show next diagram'],
    patterns: ['solid', 'dashed'],
  },
  'mermaid-sequence-note': {
    actors: ['Editor', 'Renderer'],
    messages: ['Render source'],
    patterns: ['solid'],
  },
} as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openSequence(page: Page, state: string, width: number, theme: string) {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  const renderer = page.locator(`#${state} .mermaid-renderer`);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true', { timeout: 120_000 });
  return renderer.locator('svg[aria-roledescription="sequence"]');
}

async function expectSequenceContract(
  svg: ReturnType<Page['locator']>,
  contract: (typeof contracts)[keyof typeof contracts],
  theme: (typeof appearances)[number],
) {
  const result = await svg.evaluate((diagram) => {
    const actorLines = [...diagram.querySelectorAll<SVGLineElement>('.actor-line')];
    const actorCenters = actorLines.map((line) => Number(line.getAttribute('x1')));
    const actors = [
      ...diagram.querySelectorAll<SVGGraphicsElement>(
        '[data-et="participant"], g.actor-man.actor-top',
      ),
    ]
      .map((actor) => ({
        label: actor.textContent?.trim() ?? '',
        center: actor.getBBox().x + actor.getBBox().width / 2,
      }))
      .sort((a, b) => a.center - b.center)
      .map(({ label }) => label);

    const participantBounds = [
      ...diagram.querySelectorAll<SVGGraphicsElement>(
        '[data-et="participant"], g.actor-man.actor-top',
      ),
    ].map((actor) => actor.getBBox());
    const messages: Array<{
      text: string;
      gap: number;
      precedingArrowGap: number | null;
      horizontalInset: number;
      destinationGap: number;
      overlapsParticipant: boolean;
      pattern: 'solid' | 'dashed';
    }> = [];
    let pending: SVGTextElement[] = [];
    let previousArrowY: number | null = null;
    for (const child of diagram.children) {
      if (child.matches('text.messageText')) pending.push(child as SVGTextElement);
      if (!child.matches('line.messageLine0, line.messageLine1')) continue;
      const line = child as SVGLineElement;
      const lineY = Number(line.getAttribute('y1'));
      const labelBounds = pending.map((label) => label.getBBox());
      const labelLeft = Math.min(...labelBounds.map((bounds) => bounds.x));
      const labelRight = Math.max(...labelBounds.map((bounds) => bounds.x + bounds.width));
      const labelTop = Math.min(...labelBounds.map((bounds) => bounds.y));
      const labelBottom = Math.max(...labelBounds.map((bounds) => bounds.y + bounds.height));
      const sourceX = Number(line.getAttribute('x1'));
      const destinationX = Number(line.getAttribute('x2'));
      const sourceCenter = actorCenters.reduce((nearest, center) =>
        Math.abs(center - sourceX) < Math.abs(nearest - sourceX) ? center : nearest,
      );
      const destinationCenter = actorCenters.reduce((nearest, center) =>
        Math.abs(center - destinationX) < Math.abs(nearest - destinationX) ? center : nearest,
      );
      const spanLeft = Math.min(sourceCenter, destinationCenter);
      const spanRight = Math.max(sourceCenter, destinationCenter);
      const style = getComputedStyle(line);
      messages.push({
        text: pending.map((label) => label.textContent?.trim()).join(' '),
        gap: lineY - labelBottom,
        precedingArrowGap: previousArrowY === null ? null : labelTop - previousArrowY,
        horizontalInset: Math.min(labelLeft - spanLeft, spanRight - labelRight),
        destinationGap: Math.min(...actorCenters.map((center) => Math.abs(center - destinationX))),
        overlapsParticipant: participantBounds.some(
          (bounds) =>
            labelLeft < bounds.x + bounds.width &&
            labelRight > bounds.x &&
            labelTop < bounds.y + bounds.height &&
            labelBottom > bounds.y,
        ),
        pattern: style.strokeDasharray === 'none' ? 'solid' : 'dashed',
      });
      pending = [];
      previousArrowY = lineY;
    }

    const messageLabels = [...diagram.querySelectorAll<SVGTextElement>('text.messageText')];
    const labelSurfaces = messageLabels
      .map((label) => label.previousElementSibling)
      .filter(Boolean);
    const context = document.createElement('canvas').getContext('2d')!;
    const rgb = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (values: number[]) => {
      const channels = values.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const canvas = getComputedStyle(diagram).backgroundColor;
    const canvasRgb = rgb(canvas);
    const contrast = (color: string, opacity = 1) => {
      const foregroundRgb = rgb(color).map(
        (channel, index) => channel * opacity + canvasRgb[index] * (1 - opacity),
      );
      const foreground = luminance(foregroundRgb);
      const background = luminance(canvasRgb);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    };
    const textContrast = (element: Element) => contrast(getComputedStyle(element).fill);
    const messageLines = [
      ...diagram.querySelectorAll<SVGLineElement>('.messageLine0, .messageLine1'),
    ];
    const messageStrokes = messageLines.map((line) => getComputedStyle(line).stroke);
    const arrowheadStrokes = messageLines.map((line) => {
      const markerId = line.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
      const markerPath = markerId
        ? diagram.querySelector<SVGPathElement>(`#${CSS.escape(markerId)} path`)
        : null;
      return markerPath ? getComputedStyle(markerPath).stroke : null;
    });
    const structureElements = [
      ...actorLines,
      ...diagram.querySelectorAll<SVGLineElement>('.sequence-frame-line, .sequence-branch-divider'),
    ];
    const structureContrasts = structureElements.map((element) => {
      const style = getComputedStyle(element);
      return contrast(style.stroke, Number(style.opacity));
    });

    const viewBox = diagram.viewBox.baseVal;
    const visibleElements = [
      ...diagram.querySelectorAll<SVGGraphicsElement>(
        '[data-et="participant"], g.actor-man.actor-top, text.messageText, line.messageLine0, line.messageLine1, .sequence-construct, .sequence-note',
      ),
    ];
    return {
      actors,
      messages,
      actorWeight: Number(
        getComputedStyle(diagram.querySelector('.actor.actor-box, .actor.actor-man')!).fontWeight,
      ),
      lifelineOpacity: Number(getComputedStyle(actorLines[0]).opacity),
      messageOpacity: Number(
        getComputedStyle(diagram.querySelector('.messageLine0, .messageLine1')!).opacity,
      ),
      minimumMessageContrast: Math.min(...messageStrokes.map((stroke) => contrast(stroke))),
      minimumStructureContrast: Math.min(...structureContrasts),
      maximumStructureContrast: Math.max(...structureContrasts),
      arrowheadsMatchMessages: arrowheadStrokes.every(
        (stroke, index) =>
          stroke !== null &&
          rgb(stroke).every((channel, channelIndex) =>
            Number.isNaN(channel)
              ? false
              : Math.abs(channel - rgb(messageStrokes[index])[channelIndex]) <= 1,
          ),
      ),
      lightMessageChannelSpread: messageStrokes.map((stroke) => {
        const channels = rgb(stroke);
        return Math.max(...channels) - Math.min(...channels);
      }),
      labelWidths: messageLabels.map((label) => label.getBBox().width),
      labelSurfaceCount: labelSurfaces.filter((surface) =>
        surface?.classList.contains('edge-label-knockout'),
      ).length,
      opaqueSurfaces: labelSurfaces.every((surface) => {
        const style = getComputedStyle(surface!);
        return style.fill === canvas && style.opacity === '1' && style.fillOpacity === '1';
      }),
      minimumLabelContrast: Math.min(...messageLabels.map(textContrast)),
      contained: visibleElements.every((element) => {
        const bounds = element.getBBox();
        return (
          bounds.x >= viewBox.x - 1 &&
          bounds.y >= viewBox.y - 1 &&
          bounds.x + bounds.width <= viewBox.x + viewBox.width + 1 &&
          bounds.y + bounds.height <= viewBox.y + viewBox.height + 1
        );
      }),
    };
  });

  expect(result.actors).toEqual(contract.actors);
  expect(result.messages.map(({ text }) => text)).toEqual(contract.messages);
  expect(result.messages.map(({ pattern }) => pattern)).toEqual(contract.patterns);
  expect(result.messages.every(({ gap }) => gap >= 6 && gap <= 16)).toBe(true);
  expect(
    result.messages.every(
      ({ precedingArrowGap }) => precedingArrowGap === null || precedingArrowGap >= 12,
    ),
  ).toBe(true);
  expect(result.messages.every(({ horizontalInset }) => horizontalInset >= 10)).toBe(true);
  expect(result.messages.every(({ overlapsParticipant }) => !overlapsParticipant)).toBe(true);
  expect(result.messages.every(({ destinationGap }) => Math.abs(destinationGap - 5) <= 0.5)).toBe(
    true,
  );
  expect(Math.max(...result.labelWidths)).toBeLessThanOrEqual(175);
  expect(result.labelSurfaceCount).toBe(result.labelWidths.length);
  expect(result.opaqueSurfaces).toBe(true);
  expect(result.minimumLabelContrast).toBeGreaterThanOrEqual(4.5);
  expect(result.minimumMessageContrast).toBeGreaterThanOrEqual(3);
  expect(result.minimumStructureContrast).toBeGreaterThanOrEqual(1.4);
  expect(result.maximumStructureContrast).toBeLessThan(result.minimumMessageContrast);
  expect(result.arrowheadsMatchMessages).toBe(true);
  if (theme === 'light') {
    expect(Math.max(...result.lightMessageChannelSpread)).toBeLessThanOrEqual(8);
  }
  expect(result.actorWeight).toBeGreaterThanOrEqual(500);
  expect(result.lifelineOpacity).toBeLessThan(result.messageOpacity);
  expect(result.contained).toBe(true);
}

async function expectAltHierarchy(svg: ReturnType<Page['locator']>) {
  const result = await svg.locator('.sequence-construct-alt').evaluate((group) => {
    const conditions = [...group.querySelectorAll<SVGTextElement>('.sequence-branch-condition')];
    const cues = [...group.querySelectorAll<SVGLineElement>('.sequence-branch-cue')];
    const label = group.querySelector<SVGTextElement>('.sequence-construct-label-text')!;
    const surfaces = [...group.querySelectorAll<SVGRectElement>('.sequence-branch-surface')];
    const canvas = document.createElement('canvas').getContext('2d')!;
    const rgb = (color: string) => {
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      return [...canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (color: string) => {
      const channels = rgb(color).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const canvasColor = getComputedStyle(group.ownerSVGElement!).backgroundColor;
    const surfaceFills = surfaces.map((surface) => getComputedStyle(surface).fill);
    const surfaceContrasts = surfaceFills.map((fill) => {
      const foreground = luminance(fill);
      const background = luminance(canvasColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    return {
      outer: group.querySelectorAll('.sequence-frame-line').length,
      dividers: group.querySelectorAll('.sequence-branch-divider').length,
      conditionXs: conditions.map((condition) => condition.getAttribute('x')),
      conditionAnchors: conditions.map((condition) => condition.getAttribute('text-anchor')),
      roles: [...new Set(conditions.map((condition) => condition.dataset.sequenceBranch))],
      surfaceRoles: [...new Set(surfaces.map((surface) => surface.dataset.sequenceBranch))],
      surfaces: surfaces.length,
      surfaceFills: surfaceFills.map(rgb),
      surfaceContrasts,
      cuePatterns: cues.map((cue) => getComputedStyle(cue).strokeDasharray),
      cueStrokes: cues.map((cue) => rgb(getComputedStyle(cue).stroke)),
      labelSize: Number.parseFloat(getComputedStyle(label).fontSize),
    };
  });
  expect(result).toMatchObject({ outer: 4, dividers: 1, surfaces: 2, labelSize: 11 });
  expect(new Set(result.conditionXs).size).toBe(1);
  expect(result.conditionAnchors.every((anchor) => anchor === 'start')).toBe(true);
  expect(result.roles.sort()).toEqual(['failure', 'success']);
  expect(result.surfaceRoles).toEqual(['neutral']);
  expect(new Set(result.surfaceFills.map((fill) => fill.join(','))).size).toBe(1);
  expect(result.surfaceContrasts.every((contrast) => contrast > 1 && contrast < 1.2)).toBe(true);
  expect(new Set(result.cuePatterns).size).toBe(2);
  expect(new Set(result.cueStrokes.map((stroke) => stroke.join(','))).size).toBe(1);
}

async function expectLoopHierarchy(svg: ReturnType<Page['locator']>) {
  const result = await svg.locator('.sequence-construct-loop').evaluate((group) => {
    const surface = group.querySelector<SVGRectElement>('.sequence-branch-surface')!;
    const style = getComputedStyle(surface);
    return {
      outer: group.querySelectorAll('.sequence-frame-line').length,
      dividers: group.querySelectorAll('.sequence-branch-divider').length,
      surfaces: group.querySelectorAll('.sequence-branch-surface').length,
      surfaceRole: surface.dataset.sequenceBranch,
      surfaceFill: style.fill,
      canvasFill: getComputedStyle(group.ownerSVGElement!).backgroundColor,
      conditionXs: [...group.querySelectorAll<SVGTextElement>('.sequence-branch-condition')].map(
        (condition) => condition.getAttribute('x'),
      ),
      conditionLabel: group
        .querySelector<SVGTextElement>('.sequence-branch-condition')
        ?.getAttribute('aria-label'),
      conditionLines: group.querySelectorAll('.sequence-branch-condition tspan').length,
    };
  });
  expect(result).toMatchObject({ outer: 4, dividers: 0, surfaces: 1, surfaceRole: 'neutral' });
  expect(result.surfaceFill).not.toBe(result.canvasFill);
  expect(new Set(result.conditionXs).size).toBe(1);
  expect(result.conditionLabel).toBe('for each selected diagram');
  expect(result.conditionLines).toBeLessThanOrEqual(4);
}

async function expectNoteHierarchy(svg: ReturnType<Page['locator']>) {
  const result = await svg.locator('.sequence-note').evaluate((group) => {
    const note = group.querySelector<SVGRectElement>('.note')!;
    const text = group.querySelector<SVGTextElement>('.sequence-note-text')!;
    const noteBounds = note.getBBox();
    const textBounds = text.getBBox();
    const participantCenters = [
      ...group.ownerSVGElement!.querySelectorAll<SVGLineElement>('.actor-line'),
    ]
      .map((line) => Number(line.getAttribute('x1')))
      .sort((a, b) => a - b);
    const style = getComputedStyle(note);
    return {
      widthDelta: noteBounds.width - textBounds.width,
      height: noteBounds.height,
      centerDelta:
        noteBounds.x +
        noteBounds.width / 2 -
        (participantCenters[0] + participantCenters.at(-1)!) / 2,
      strokeWidth: style.strokeWidth,
      radius: Number(note.getAttribute('rx')),
      fillDiffersFromCanvas:
        style.fill !== getComputedStyle(group.ownerSVGElement!).backgroundColor,
    };
  });
  expect(result.widthDelta).toBeGreaterThanOrEqual(16);
  expect(result.widthDelta).toBeLessThanOrEqual(24);
  expect(result.height).toBeLessThanOrEqual(32);
  expect(Math.abs(result.centerDelta)).toBeLessThanOrEqual(1);
  expect(result).toMatchObject({ strokeWidth: '0px', radius: 6, fillDiffersFromCanvas: true });
}

for (const [state, contract] of Object.entries(contracts)) {
  for (const theme of appearances) {
    for (const width of widths) {
      test(`${state} hierarchy · ${theme} · ${width}px`, async ({ page }) => {
        test.setTimeout(180_000);
        const svg = await openSequence(page, state, width, theme);
        await expectSequenceContract(svg, contract, theme);
        if (state === 'mermaid-sequence-alt') await expectAltHierarchy(svg);
        if (state === 'mermaid-sequence-loop') await expectLoopHierarchy(svg);
        if (state === 'mermaid-sequence-note') await expectNoteHierarchy(svg);
      });
    }
  }
}
