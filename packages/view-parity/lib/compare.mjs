import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export function compareImages(referenceBuffer, candidateBuffer) {
  const reference = PNG.sync.read(referenceBuffer);
  const candidate = PNG.sync.read(candidateBuffer);
  const width = Math.max(reference.width, candidate.width);
  const height = Math.max(reference.height, candidate.height);
  const expanded = (png) => {
    const target = new PNG({ width, height });
    PNG.bitblt(png, target, 0, 0, png.width, png.height, 0, 0);
    return target;
  };
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    expanded(reference).data,
    expanded(candidate).data,
    diff.data,
    width,
    height,
    {
      threshold: 0,
      includeAA: true,
    },
  );
  const dimensionsMatch =
    reference.width === candidate.width && reference.height === candidate.height;
  return {
    pass: dimensionsMatch && diffPixels === 0,
    diffPixels,
    dimensionsMatch,
    reference: { width: reference.width, height: reference.height },
    candidate: { width: candidate.width, height: candidate.height },
    diff: PNG.sync.write(diff),
  };
}
