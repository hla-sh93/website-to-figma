import { inflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SceneNode } from '../core/scene.js';

export type SiteFont = {
  family: string;
  style: string;
  file: string;
  /** One file for a range of weights: its style name says nothing about the text. */
  variable?: boolean;
};
/** One @font-face rule: the name the page uses and the file behind it. */
export type FontFaceRule = {
  family: string;
  weight: [number, number];
  italic: boolean;
  urls: string[];
};
export const MAX_FONT_BYTES = 6 * 1024 * 1024;
export const MAX_FONT_FILES = 48;

const tag = (bytes: Uint8Array, offset = 0) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));
const isSfnt = (bytes: Uint8Array) =>
  bytes.length > 12 && ['\u0000\u0001\u0000\u0000', 'OTTO', 'true'].includes(tag(bytes));

/** WOFF 1 is an sfnt whose tables are stored one by one, each optionally deflated. */
function fromWoff(input: Uint8Array): Uint8Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const count = view.getUint16(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 20;
    const offset = view.getUint32(at + 4),
      compressed = view.getUint32(at + 8),
      length = view.getUint32(at + 12);
    if (offset + compressed > input.length || length > MAX_FONT_BYTES)
      throw new Error('Bad font table.');
    const stored = input.subarray(offset, offset + compressed);
    const data = compressed < length ? inflateSync(stored, { maxOutputLength: length }) : stored;
    if (data.length !== length) throw new Error('Bad font table.');
    return { tag: input.subarray(at, at + 4), checksum: view.getUint32(at + 16), data };
  });
  const size = 12 + count * 16 + tables.reduce((sum, t) => sum + ((t.data.length + 3) & ~3), 0);
  if (size > MAX_FONT_BYTES * 2) throw new Error('Font too large.');
  const out = new Uint8Array(size),
    o = new DataView(out.buffer);
  out.set(input.subarray(4, 8), 0); // flavour
  const pow = 2 ** Math.floor(Math.log2(count));
  o.setUint16(4, count);
  o.setUint16(6, pow * 16);
  o.setUint16(8, Math.log2(pow));
  o.setUint16(10, count * 16 - pow * 16);
  let offset = 12 + count * 16;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    out.set(t.tag, at);
    o.setUint32(at + 4, t.checksum);
    o.setUint32(at + 8, offset);
    o.setUint32(at + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

/** A web font as an installable TrueType or OpenType file, or nothing when it is not one. */
export async function toInstallableFont(input: Uint8Array): Promise<Uint8Array | undefined> {
  if (input.length < 16 || input.length > MAX_FONT_BYTES) return;
  try {
    let font: Uint8Array | undefined;
    if (isSfnt(input)) font = input;
    else if (tag(input) === 'wOFF') font = fromWoff(input);
    else if (tag(input) === 'wOF2') {
      const { decompress } = (await import('wawoff2')) as {
        decompress(data: Uint8Array): Promise<Uint8Array>;
      };
      font = await decompress(input);
    }
    return font && isSfnt(font) && font.length <= MAX_FONT_BYTES * 2 ? font : undefined;
  } catch {
    return;
  }
}

/** Family and style as the font itself names them: what Figma lists after install. */
export function fontNames(
  font: Uint8Array,
): { family: string; style: string; variable?: boolean } | undefined {
  try {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const count = view.getUint16(4);
    let name = -1,
      variable = false;
    for (let i = 0; i < count; i++) {
      const table = tag(font, 12 + i * 16);
      if (table === 'name') name = view.getUint32(12 + i * 16 + 8);
      if (table === 'fvar') variable = true;
    }
    if (name < 0) return;
    const records = view.getUint16(name + 2),
      strings = name + view.getUint16(name + 4);
    const found = new Map<number, string>();
    for (let i = 0; i < records; i++) {
      const at = name + 6 + i * 12;
      const platform = view.getUint16(at),
        language = view.getUint16(at + 4),
        id = view.getUint16(at + 6),
        length = view.getUint16(at + 8),
        offset = strings + view.getUint16(at + 10);
      if (![1, 2, 16, 17].includes(id) || offset + length > font.length) continue;
      const bytes = font.subarray(offset, offset + length);
      const english = platform === 3 ? language === 0x409 : platform === 1 && language === 0;
      // Windows and Unicode names are UTF-16BE; old Macintosh names are one byte each.
      const value =
        platform === 1
          ? String.fromCharCode(...bytes)
          : Array.from({ length: length >> 1 }, (_, k) =>
              String.fromCharCode((bytes[k * 2]! << 8) | bytes[k * 2 + 1]!),
            ).join('');
      if (value.trim() && (english || !found.has(id))) found.set(id, value.trim());
    }
    const family = found.get(16) ?? found.get(1),
      style = found.get(17) ?? found.get(2) ?? 'Regular';
    return family ? { family, style, ...(variable ? { variable } : {}) } : undefined;
  } catch {
    return;
  }
}

const safe = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60);

/**
 * Writes the fonts a page loaded as installable files, named by family and style.
 * The files are the site's own; installing them is for whoever holds the right to.
 */
const unquote = (value: string) =>
  value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
const cssWeight = (value: string | undefined): [number, number] => {
  const parts = (value ?? 'normal')
    .trim()
    .split(/\s+/)
    .map((part) => (part === 'bold' ? 700 : part === 'normal' ? 400 : Number(part)))
    .filter((n) => Number.isFinite(n));
  const low = parts[0] ?? 400;
  return [low, parts[1] ?? low];
};
/** The @font-face rules of a style sheet, with file addresses made absolute. */
export function parseFontFaces(css: string, base: string): FontFaceRule[] {
  const rules: FontFaceRule[] = [];
  for (const block of css.slice(0, 4_000_000).matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = block[1]!;
    const value = (name: string) =>
      new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i').exec(body)?.[1];
    const family = value('font-family');
    if (!family) continue;
    const urls: string[] = [];
    for (const src of body.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      if (src[2]!.startsWith('data:')) continue;
      try {
        urls.push(new URL(src[2]!, base).href);
      } catch {
        // Not an address.
      }
    }
    if (urls.length)
      rules.push({
        family: unquote(family),
        weight: cssWeight(value('font-weight')),
        italic: /italic|oblique/i.test(value('font-style') ?? ''),
        urls,
      });
    if (rules.length >= 400) break;
  }
  return rules;
}
const sameFamily = (a: string, b: string) =>
  a.toLowerCase().replace(/[\s_-]/g, '') === b.toLowerCase().replace(/[\s_-]/g, '');
/**
 * Tells each piece of text which saved file drew it: the family and style that font
 * has once installed, which is what the design tool lists. A page asks for "Graphik";
 * the file calls itself "Graphik Web".
 */
export function assignSiteFonts(
  roots: SceneNode[],
  rules: FontFaceRule[],
  saved: Map<string, SiteFont>,
): void {
  const usable = rules.filter((rule) => rule.urls.some((url) => saved.has(url)));
  if (!usable.length) return;
  const cache = new Map<string, SiteFont | null>();
  const find = (stack: string, weight: number, style: string): SiteFont | null => {
    const key = stack + '|' + weight + '|' + style;
    if (cache.has(key)) return cache.get(key)!;
    const italic = /italic|oblique/i.test(style);
    // The first family of the stack is the one the page means to show.
    const first = unquote(stack.split(',')[0] ?? '');
    const faces = usable.filter((rule) => sameFamily(rule.family, first));
    const distance = (rule: FontFaceRule) =>
      (rule.italic === italic ? 0 : 2000) +
      (weight < rule.weight[0]
        ? rule.weight[0] - weight
        : weight > rule.weight[1]
          ? weight - rule.weight[1]
          : 0);
    const best = [...faces].sort((a, b) => distance(a) - distance(b))[0];
    const url = best?.urls.find((u) => saved.has(u));
    const file = url ? saved.get(url)! : null;
    // A variable font serves every weight from one file, so only its family is known.
    const result =
      file && (file.variable || best!.weight[0] !== best!.weight[1])
        ? { ...file, style: '' }
        : file;
    cache.set(key, result);
    return result;
  };
  const visit = (node: SceneNode) => {
    const text = node.text;
    if (text) {
      const font = find(text.fontFamily, text.fontWeight, text.fontStyle);
      if (font) {
        text.resolvedFontFamily = font.family;
        if (font.style) text.resolvedFontStyle = font.style;
      }
      for (const run of text.runs ?? []) {
        const own = find(
          run.fontFamily ?? text.fontFamily,
          run.fontWeight ?? text.fontWeight,
          run.fontStyle ?? text.fontStyle,
        );
        if (own) {
          run.resolvedFontFamily = own.family;
          if (own.style) run.resolvedFontStyle = own.style;
        }
      }
    }
    node.children.forEach(visit);
  };
  roots.forEach(visit);
}
export async function saveSiteFonts(
  folder: string,
  host: string,
  downloads: [string, Uint8Array][],
): Promise<{ folder: string; files: SiteFont[]; byUrl: Map<string, SiteFont> } | undefined> {
  const target = join(folder, safe(host) || 'site');
  const files: SiteFont[] = [],
    seen = new Map<string, SiteFont>(),
    byUrl = new Map<string, SiteFont>();
  for (const [url, bytes] of downloads.slice(0, MAX_FONT_FILES * 2)) {
    if (files.length >= MAX_FONT_FILES) break;
    const font = await toInstallableFont(bytes);
    const names = font && fontNames(font);
    if (!font || !names) continue;
    const base = safe(`${names.family}-${names.style}`);
    if (!base) continue;
    const known = seen.get(base.toLowerCase());
    if (known) {
      byUrl.set(url, known);
      continue;
    }
    const file = base + (tag(font) === 'OTTO' ? '.otf' : '.ttf');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, file), font);
    const entry = { ...names, file };
    seen.set(base.toLowerCase(), entry);
    byUrl.set(url, entry);
    files.push(entry);
  }
  return files.length ? { folder: target, files, byUrl } : undefined;
}
