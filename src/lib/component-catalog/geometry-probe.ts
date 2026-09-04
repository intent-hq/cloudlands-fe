const DEFAULT_MATCH = /^data-.*-(?:hover-card|probe)(?:-|$)/;

const DEFAULT_COMPUTED_FIELDS = [
  'fontWeight',
  'fontSize',
  'lineHeight',
  'gap',
  'marginTop',
  'marginBottom',
  'paddingLeft',
  'paddingRight',
] as const;

type DefaultComputedField = (typeof DEFAULT_COMPUTED_FIELDS)[number];

export interface GeometryProbeOptions {
  selector?: string;
  match?: (attrName: string) => boolean;
  computed?: string[];
}

export type GeometryProbeMeasurement = {
  x: number;
  y: number;
  width: number;
  height: number;
} & Record<DefaultComputedField, number> &
  Record<string, number>;

export interface GeometryProbeResult {
  root: { width: number; height: number };
  probes: Record<string, GeometryProbeMeasurement>;
}

function round(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isDefaultProbeAttribute(attrName: string): boolean {
  return attrName === 'data-probe' || DEFAULT_MATCH.test(attrName);
}

function firstMatchingAttribute(
  element: Element,
  match: (attrName: string) => boolean,
): Attr | undefined {
  return [...element.attributes].find((attribute) => match(attribute.name));
}

function firstDataAttribute(element: Element): Attr | undefined {
  return [...element.attributes].find((attribute) => attribute.name.startsWith('data-'));
}

function attributeKey(attribute: Attr): string {
  return attribute.value ? `${attribute.name}=${attribute.value}` : attribute.name;
}

function cssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function numericComputedValue(style: CSSStyleDeclaration, property: string): number {
  const value = style.getPropertyValue(cssPropertyName(property));
  const parsed = Number.parseFloat(value);
  return round(Number.isFinite(parsed) ? parsed : 0);
}

function defaultComputedValues(style: CSSStyleDeclaration): Record<DefaultComputedField, number> {
  return {
    fontWeight: numericComputedValue(style, 'fontWeight'),
    fontSize: numericComputedValue(style, 'fontSize'),
    lineHeight: numericComputedValue(style, 'lineHeight'),
    gap: numericComputedValue(style, 'gap'),
    marginTop: numericComputedValue(style, 'marginTop'),
    marginBottom: numericComputedValue(style, 'marginBottom'),
    paddingLeft: numericComputedValue(style, 'paddingLeft'),
    paddingRight: numericComputedValue(style, 'paddingRight'),
  };
}

function collectElements(
  root: HTMLElement,
  options: GeometryProbeOptions,
  match: (attrName: string) => boolean,
): Array<{ element: Element; key: string }> {
  const descendants = options.selector
    ? [...root.querySelectorAll(options.selector)]
    : [...root.querySelectorAll('*')];

  return descendants.flatMap((element) => {
    const attribute = firstMatchingAttribute(element, match);
    if (attribute) return [{ element, key: attributeKey(attribute) }];
    if (!options.selector) return [];
    const dataAttribute = firstDataAttribute(element);
    return [{ element, key: dataAttribute ? attributeKey(dataAttribute) : options.selector }];
  });
}

/**
 * Measures probe-marked descendants relative to the supplied component frame.
 * Selector-only matches use their first probe attribute, then first data attribute,
 * then the selector itself as the stable key. Extra computed fields extend the defaults.
 */
export function collectGeometry(
  root: HTMLElement,
  options: GeometryProbeOptions = {},
): GeometryProbeResult {
  const rootRect = root.getBoundingClientRect();
  const match = options.match ?? isDefaultProbeAttribute;
  const extraComputedFields = [...new Set(options.computed ?? [])].filter(
    (field) => !DEFAULT_COMPUTED_FIELDS.includes(field as DefaultComputedField),
  );
  const duplicateCounts = new Map<string, number>();
  const entries = collectElements(root, options, match).map(({ element, key: baseKey }) => {
    const count = (duplicateCounts.get(baseKey) ?? 0) + 1;
    duplicateCounts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}#${count}`;
    const rect = element.getBoundingClientRect();
    const view = root.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element) ?? getComputedStyle(element);
    const extraComputed = Object.fromEntries(
      extraComputedFields.map((property) => [property, numericComputedValue(style, property)]),
    );

    return [
      key,
      {
        x: round(rect.left - rootRect.left),
        y: round(rect.top - rootRect.top),
        width: round(rect.width),
        height: round(rect.height),
        ...defaultComputedValues(style),
        ...extraComputed,
      },
    ] as const;
  });

  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    root: { width: round(rootRect.width), height: round(rootRect.height) },
    probes: Object.fromEntries(entries),
  };
}
