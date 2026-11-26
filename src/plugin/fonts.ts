import type { TextSpec, TextRun, ScenePackage, SceneNode } from '../core/scene.js';
export type FontFace = {
  family: string;
  style: string;
  variationSettings?: Record<string, number>;
};
export type FontResolution = { font: FontFace; exact: boolean };
export type FontRequest = Pick<
  TextSpec,
  | 'fontFamily'
  | 'fontStyle'
  | 'fontWeight'
  | 'resolvedFontFamily'
  | 'resolvedFontStyle'
  | 'variationSettings'
>;
export const normalizeFamily = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
export function splitFontFamilies(value: string): string[] {
  const result: string[] = [];
  let token = '',
    quote = '';
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = '';
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ',') {
      if (token.trim()) result.push(token.trim());
      token = '';
    } else token += character;
  }
  if (token.trim()) result.push(token.trim());
  return result;
}
export const fontLabel = (spec: FontRequest) =>
  spec.resolvedFontFamily ?? splitFontFamilies(spec.fontFamily)[0] ?? spec.fontFamily;
export const fontKey = (spec: FontRequest) =>
  JSON.stringify([
    spec.fontFamily,
    spec.fontStyle,
    spec.fontWeight,
    spec.resolvedFontFamily ?? null,
    spec.variationSettings ?? null,
    spec.resolvedFontStyle ?? null,
  ]);
export function fontRequest(text: TextSpec, run?: TextRun): FontRequest {
  const result: FontRequest = {
    fontFamily: run?.fontFamily ?? text.fontFamily,
    fontStyle: run?.fontStyle ?? text.fontStyle,
    fontWeight: run?.fontWeight ?? text.fontWeight,
  };
  const sameFamily = !run?.fontFamily || run.fontFamily === text.fontFamily;
  const resolved = run?.resolvedFontFamily ?? (sameFamily ? text.resolvedFontFamily : undefined);
  const face = run?.resolvedFontFamily
    ? run.resolvedFontStyle
    : sameFamily && !run?.fontWeight && !run?.fontStyle
      ? text.resolvedFontStyle
      : undefined;
  if (resolved && face) result.resolvedFontStyle = face;
  const axes = run?.variationSettings ?? (sameFamily ? text.variationSettings : undefined);
  if (resolved) result.resolvedFontFamily = resolved;
  if (axes) result.variationSettings = axes;
  return result;
}
function weight(style: string): number {
  const s = normalizeFamily(style);
  if (s.includes('thin')) return 100;
  if (s.includes('extralight') || s.includes('ultralight')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  if (s.includes('semibold') || s.includes('demibold')) return 600;
  if (s.includes('extrabold') || s.includes('ultrabold')) return 800;
  if (s.includes('black') || s.includes('heavy')) return 900;
  if (s.includes('bold')) return 700;
  return 400;
}
export function resolveFont(
  spec: FontRequest,
  available: FontFace[],
  fallback = 'Inter',
  axesByFamily: Record<string, string[] | null> = {},
): FontResolution {
  // A font matched to its saved file is known by the file's own name; a copy already
  // in the editor under the name the page uses (a Google font) is the same font.
  const fromFile = !!(spec.resolvedFontFamily && spec.resolvedFontStyle);
  const first = splitFontFamilies(spec.fontFamily)[0];
  const families = spec.resolvedFontFamily
    ? [spec.resolvedFontFamily, ...(fromFile && first ? [first] : [])]
    : splitFontFamilies(spec.fontFamily);
  let chosenIndex = -1,
    candidates: FontFace[] = [];
  for (let i = 0; i < families.length; i++) {
    candidates = available.filter(
      (f) => normalizeFamily(f.family) === normalizeFamily(families[i]!),
    );
    if (candidates.length) {
      chosenIndex = i;
      break;
    }
  }
  if (!candidates.length)
    candidates = available.filter((f) => normalizeFamily(f.family) === normalizeFamily(fallback));
  if (!candidates.length)
    throw new Error(
      `No usable editor font for ${fontLabel(spec)}. Enable the font or choose an available fallback.`,
    );
  // The capture knows which file drew the text: that face, by its own style name
  // ("Book", "Roman"), is exact whatever weight the page called it.
  const named =
    chosenIndex === 0 && spec.resolvedFontStyle
      ? candidates.find(
          (f) => normalizeFamily(f.style) === normalizeFamily(spec.resolvedFontStyle!),
        )
      : undefined;
  if (named) return { font: { family: named.family, style: named.style }, exact: true };
  const italic = /italic|oblique/i.test(spec.fontStyle),
    desiredWeight = spec.variationSettings?.wght ?? spec.fontWeight;
  const score = (f: FontFace) =>
    Math.abs(weight(f.style) - desiredWeight) +
    (/italic|oblique/i.test(f.style) !== italic ? 2000 : 0);
  candidates = [...candidates].sort((a, b) => score(a) - score(b));
  const face = candidates[0]!;
  const axes = axesByFamily[face.family] ?? [];
  const variationSettings: Record<string, number> = {};
  if (chosenIndex >= 0) {
    for (const [tag, value] of Object.entries(spec.variationSettings ?? {}))
      if (axes.includes(tag)) variationSettings[tag] = value;
    if (axes.includes('wght')) variationSettings.wght = desiredWeight;
  }
  const font: FontFace = {
    family: face.family,
    style: face.style,
    ...(Object.keys(variationSettings).length ? { variationSettings } : {}),
  };
  const supportedAxes = Object.keys(spec.variationSettings ?? {}).every((axis) =>
    axes.includes(axis),
  );
  return {
    font,
    exact:
      (chosenIndex === 0 || (fromFile && chosenIndex === 1)) &&
      (axes.includes('wght') || weight(face.style) === desiredWeight) &&
      /italic|oblique/i.test(face.style) === italic &&
      supportedAxes,
  };
}

/** Every distinct font request in a scene. Small enough to send instead of the scene. */
export function collectFontRequests(pkg: ScenePackage): FontRequest[] {
  const requests = new Map<string, FontRequest>();
  const visit = (node: SceneNode) => {
    if (node.text) {
      const base = fontRequest(node.text);
      requests.set(fontKey(base), base);
      for (const run of node.text.runs ?? []) {
        const request = fontRequest(node.text, run);
        requests.set(fontKey(request), request);
      }
    }
    node.children.forEach(visit);
  };
  pkg.screens.forEach((screen) => visit(screen.root));
  return [...requests.values()];
}

/** Validates font requests received across the UI/main boundary. */
export function validateFontRequests(input: unknown): FontRequest[] {
  if (!Array.isArray(input) || input.length > 5000) throw new Error('Invalid font list.');
  return input.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid font request.');
    const r = item as Record<string, unknown>;
    if (
      typeof r.fontFamily !== 'string' ||
      typeof r.fontStyle !== 'string' ||
      typeof r.fontWeight !== 'number' ||
      !Number.isFinite(r.fontWeight) ||
      r.fontFamily.length > 2000 ||
      (r.resolvedFontFamily !== undefined && typeof r.resolvedFontFamily !== 'string')
    )
      throw new Error('Invalid font request.');
    const result: FontRequest = {
      fontFamily: r.fontFamily,
      fontStyle: r.fontStyle,
      fontWeight: r.fontWeight,
    };
    if (typeof r.resolvedFontFamily === 'string') result.resolvedFontFamily = r.resolvedFontFamily;
    if (typeof r.resolvedFontStyle === 'string' && r.resolvedFontStyle.length <= 120)
      result.resolvedFontStyle = r.resolvedFontStyle;
    if (r.variationSettings && typeof r.variationSettings === 'object') {
      const axes: Record<string, number> = {};
      for (const [tag, value] of Object.entries(r.variationSettings).slice(0, 16))
        if (/^[A-Za-z0-9 ]{4}$/.test(tag) && typeof value === 'number' && Number.isFinite(value))
          axes[tag] = value;
      if (Object.keys(axes).length) result.variationSettings = axes;
    }
    return result;
  });
}
