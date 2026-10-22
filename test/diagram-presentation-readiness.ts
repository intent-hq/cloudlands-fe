/** Presentation readiness supplements child readiness only for wrapped diagrams. */
export function isDiagramPresentationReady(element: Element): boolean {
  const presentation = element.closest('[data-diagram-presentation]');
  return !presentation || presentation.getAttribute('data-diagram-presentation-settled') === 'true';
}
