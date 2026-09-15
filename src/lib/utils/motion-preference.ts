export function shouldReduceMotion(documentRef?: Document): boolean {
  const target = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  if (!target) return false;
  const root = target.documentElement;
  if (root.classList.contains('catalog-reduced-motion')) return true;
  if (root.classList.contains('catalog-full-motion')) return false;
  return target.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
}
