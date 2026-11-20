import type { TextSpec, TextRun } from '../core/scene.js';
export type FontFace = {
  family: string;
  style: string;
  variationSettings?: Record<string, number>;
};
export type FontResolution = { font: FontFace; exact: boolean };
export type FontRequest = Pick<
  TextSpec,
  'fontFamily' | 'fontStyle' | 'fontWeight' | 'resolvedFontFamily' | 'variationSettings'
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
  ]);
export function fontRequest(text: TextSpec, run?: TextRun): FontRequest {
  const result: FontRequest = {
    fontFamily: run?.fontFamily ?? text.fontFamily,
    fontStyle: run?.fontStyle ?? text.fontStyle,
    fontWeight: run?.fontWeight ?? text.fontWeight,
  };
  const sameFamily = !run?.fontFamily || run.fontFamily === text.fontFamily;
  const resolved = run?.resolvedFontFamily ?? (sameFamily ? text.resolvedFontFamily : undefined);
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
  const families = spec.resolvedFontFamily
    ? [spec.resolvedFontFamily]
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
      chosenIndex === 0 &&
      (axes.includes('wght') || weight(face.style) === desiredWeight) &&
      /italic|oblique/i.test(face.style) === italic &&
      supportedAxes,
  };
}
