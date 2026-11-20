import type { ImageSpec } from './image.js';
export const SCHEMA_VERSION = 1 as const;
export type TextDecoration = 'none' | 'underline' | 'strikethrough';
export type FontUsage = {
  family: string;
  postScriptName: string;
  glyphCount: number;
  isCustomFont: boolean;
};
export type RGBA = { r: number; g: number; b: number; a: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Layout = {
  mode: 'none' | 'horizontal' | 'vertical' | 'grid';
  gap: number;
  rowGap?: number;
  padding: [number, number, number, number];
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
  wrap: boolean;
  columns?: number;
  widthSizing: 'fixed' | 'fill' | 'hug';
  heightSizing: 'fixed' | 'fill' | 'hug';
  minWidth?: number;
  maxWidth?: number;
};
export type TextRun = {
  start: number;
  end: number;
  fontFamily?: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize?: number;
  color?: RGBA;
  resolvedFontFamily?: string;
  variationSettings?: Record<string, number>;
  textDecoration?: TextDecoration;
  letterSpacing?: number;
  lineHeight?: number;
};
export type TextSpec = {
  characters: string;
  fontFamily: string;
  fontStyle: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  color: RGBA;
  align: 'left' | 'center' | 'right' | 'justify';
  direction: 'ltr' | 'rtl';
  sizing?: 'inline' | 'block';
  maxLines?: number;
  resolvedFontFamily?: string;
  fontUsage?: FontUsage[];
  variationSettings?: Record<string, number>;
  textDecoration?: TextDecoration;
  runs?: TextRun[];
};
export type SceneNode = {
  id: string;
  name: string;
  kind: 'frame' | 'text' | 'image' | 'svg';
  source: { tag: string; key?: string; role?: string };
  bounds: Bounds;
  style: {
    background?: RGBA;
    border?: { color: RGBA; width: number };
    radius?: [number, number, number, number];
    opacity: number;
    zIndex?: number;
    clipContent?: boolean;
    shadow?: { color: RGBA; x: number; y: number; blur: number; spread: number }[];
  };
  layout?: Layout;
  text?: TextSpec;
  assetId?: string;
  image?: ImageSpec;
  position?: 'flow' | 'absolute';
  children: SceneNode[];
};
export type SceneScreen = {
  id: string;
  viewport: { width: number; height: number; dpr: number };
  root: SceneNode;
  screenshot?: string;
};
export type SceneAsset = {
  id: string;
  kind: 'image' | 'svg';
  mimeType: string;
  data: string;
  width: number;
  height: number;
  sourceUrl?: string;
};
export type SceneIssue = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  screenId?: string;
  nodeId?: string;
};
export type ScenePackage = {
  version: 1;
  capture: {
    id: string;
    url: string;
    title: string;
    capturedAt: string;
    engine: string;
    language?: 'ar' | 'en';
  };
  screens: SceneScreen[];
  assets: SceneAsset[];
  issues: SceneIssue[];
};
type Obj = Record<string, any>;
const fail = (path: string): never => {
  throw new Error(`Invalid scene: ${path}`);
};
const obj = (v: unknown, p: string): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p + ' must be an object');
  return v as Obj;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== 'string') fail(p + ' must be a string');
};
const num = (v: unknown, p: string, min = -Infinity, max = Infinity) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(p + ' must be a finite number in range');
};
const integer = (v: unknown, p: string, min: number, max = Infinity) => {
  num(v, p, min, max);
  if (!Number.isInteger(v)) fail(p + ' must be an integer');
};
const bool = (v: unknown, p: string) => {
  if (typeof v !== 'boolean') fail(p + ' must be boolean');
};
const en = (v: unknown, p: string, values: string[]) => {
  if (typeof v !== 'string' || !values.includes(v)) fail(p + ' has an invalid value');
};
const arr = (v: unknown, p: string, max: number): any[] => {
  if (!Array.isArray(v) || v.length > max) fail(p + ' must be a bounded array');
  return v as any[];
};
const optional = (o: Obj, k: string, fn: (v: any, p: string) => void, p: string) => {
  if (Object.hasOwn(o, k)) fn(o[k], `${p}.${k}`);
};
const color = (v: unknown, p: string) => {
  const o = obj(v, p);
  for (const k of ['r', 'g', 'b', 'a']) num(o[k], `${p}.${k}`, 0, 1);
};
const tuple = (v: unknown, p: string, n: number, min = -Infinity) => {
  const a = arr(v, p, n);
  if (a.length !== n) fail(p + ' has invalid length');
  a.forEach((x, i) => num(x, `${p}[${i}]`, min));
};
// Walk all properties, including extras, before interpreting the contract. This also
// excludes accessors, exotic prototypes, sparse arrays and prototype-sensitive keys.
function json(
  v: unknown,
  p: string,
  active: Set<object>,
  depth: number,
  budget: { count: number; strings: number },
): void {
  if (++budget.count > 500000 || depth > 260) fail('JSON input exceeds structural limits');
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'string') {
    budget.strings += v.length;
    if (budget.strings > 40 * 1024 * 1024) fail('JSON strings exceed limit');
    return;
  }
  if (typeof v === 'number') {
    num(v, p);
    return;
  }
  if (typeof v !== 'object') fail(p + ' is not JSON data');
  const value = v as object;
  const proto = Object.getPrototypeOf(value);
  if (
    Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null
  )
    fail(p + ' is not plain JSON data');
  if (active.has(value)) fail(p + ' contains a cycle');
  active.add(value);
  if (Object.getOwnPropertySymbols(value).length) fail(p + ' contains symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail(p + ' is not a dense JSON array');
    for (let i = 0; i < value.length; i++)
      if (!Object.hasOwn(descriptors, String(i))) fail(p + ' is not a dense JSON array');
  }
  for (const key of Object.keys(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = descriptors[key]!;
    if (!('value' in d) || !d.enumerable || ['__proto__', 'prototype', 'constructor'].includes(key))
      fail(p + ' contains unsafe properties');
    json(d.value, p + '.field', active, depth + 1, budget);
  }
  active.delete(value);
}
export function validateScene(input: unknown): ScenePackage {
  json(input, 'input', new Set(), 0, { count: 0, strings: 0 });
  const s = obj(input, 'scene');
  if (s.version !== 1) fail('version must be 1');
  const capture = obj(s.capture, 'capture');
  for (const k of ['id', 'url', 'title', 'capturedAt', 'engine']) str(capture[k], `capture.${k}`);
  optional(capture, 'language', (v, p) => en(v, p, ['ar', 'en']), 'capture');
  let encoded = 0;
  const base64 = (v: unknown, p: string) => {
    str(v, p);
    const x = v as string;
    encoded += x.length;
    if (encoded > 32 * 1024 * 1024) fail('encoded data exceeds 32 MiB');
    if (x.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(x)) fail(p + ' must be raw base64');
  };
  const assets = new Map<string, string>();
  for (const [i, v] of arr(s.assets, 'assets', 300).entries()) {
    const p = `assets[${i}]`,
      a = obj(v, p);
    str(a.id, p + '.id');
    if (assets.has(a.id)) fail(p + ' duplicate asset id');
    en(a.kind, p + '.kind', ['image', 'svg']);
    assets.set(a.id, a.kind);
    str(a.mimeType, p + '.mimeType');
    base64(a.data, p + '.data');
    num(a.width, p + '.width', 0);
    num(a.height, p + '.height', 0);
    optional(a, 'sourceUrl', str, p);
  }
  let count = 0;
  const screens = new Map<string, Set<string>>();
  const fontProperties = (o: Obj, p: string) => {
    optional(o, 'resolvedFontFamily', str, p);
    optional(o, 'textDecoration', (v, q) => en(v, q, ['none', 'underline', 'strikethrough']), p);
    optional(
      o,
      'variationSettings',
      (v, q) => {
        const axes = obj(v, q);
        if (Object.keys(axes).length > 16) fail(q + ' exceeds axis limit');
        for (const [tag, value] of Object.entries(axes)) {
          if (!/^[A-Za-z0-9 ]{4}$/.test(tag)) fail(q + ' has invalid axis tag');
          num(value, q + '.axis', -100000, 100000);
        }
      },
      p,
    );
  };
  const text = (v: unknown, p: string) => {
    const t = obj(v, p);
    for (const k of ['characters', 'fontFamily', 'fontStyle']) str(t[k], p + '.' + k);
    num(t.fontWeight, p + '.fontWeight', 1, 1000);
    num(t.fontSize, p + '.fontSize', 0);
    num(t.lineHeight, p + '.lineHeight', 0);
    num(t.letterSpacing, p + '.letterSpacing');
    color(t.color, p + '.color');
    en(t.align, p + '.align', ['left', 'center', 'right', 'justify']);
    en(t.direction, p + '.direction', ['ltr', 'rtl']);
    optional(t, 'sizing', (v, q) => en(v, q, ['inline', 'block']), p);
    optional(t, 'maxLines', (v, q) => integer(v, q, 1, 1000), p);
    fontProperties(t, p);
    optional(
      t,
      'fontUsage',
      (v, q) => {
        for (const item of arr(v, q, 32)) {
          const usage = obj(item, q);
          str(usage.family, q + '.family');
          str(usage.postScriptName, q + '.postScriptName');
          integer(usage.glyphCount, q + '.glyphCount', 0);
          bool(usage.isCustomFont, q + '.isCustomFont');
        }
      },
      p,
    );
    optional(
      t,
      'runs',
      (v, q) => {
        for (const r0 of arr(v, q, 12000)) {
          const r = obj(r0, q);
          integer(r.start, q + '.start', 0, t.characters.length);
          integer(r.end, q + '.end', r.start, t.characters.length);
          for (const k of ['fontFamily', 'fontStyle']) optional(r, k, str, q);
          optional(r, 'fontWeight', (x, y) => num(x, y, 1, 1000), q);
          optional(r, 'fontSize', (x, y) => num(x, y, 0), q);
          optional(r, 'color', color, q);
          fontProperties(r, q);
          optional(r, 'letterSpacing', num, q);
          optional(r, 'lineHeight', (v, q) => num(v, q, 0), q);
        }
      },
      p,
    );
  };
  const node = (v: unknown, p: string, ids: Set<string>, depth: number): void => {
    if (depth > 80 || ++count > 12000) fail('node count or depth exceeds limit');
    const n = obj(v, p);
    str(n.id, p + '.id');
    if (ids.has(n.id)) fail(p + ' duplicate node id');
    ids.add(n.id);
    str(n.name, p + '.name');
    en(n.kind, p + '.kind', ['frame', 'text', 'image', 'svg']);
    const source = obj(n.source, p + '.source');
    str(source.tag, p + '.source.tag');
    optional(source, 'key', str, p + '.source');
    optional(source, 'role', str, p + '.source');
    const b = obj(n.bounds, p + '.bounds');
    for (const k of ['x', 'y', 'width', 'height'])
      num(b[k], p + '.bounds.' + k, k === 'width' || k === 'height' ? 0 : -Infinity);
    const st = obj(n.style, p + '.style');
    num(st.opacity, p + '.style.opacity', 0, 1);
    optional(st, 'zIndex', (v, q) => integer(v, q, -2147483648, 2147483647), p + '.style');
    optional(st, 'background', color, p + '.style');
    optional(
      st,
      'border',
      (v, q) => {
        const b = obj(v, q);
        color(b.color, q + '.color');
        num(b.width, q + '.width', 0);
      },
      p + '.style',
    );
    optional(st, 'radius', (v, q) => tuple(v, q, 4, 0), p + '.style');
    optional(st, 'clipContent', bool, p + '.style');
    optional(
      st,
      'shadow',
      (v, q) => {
        for (const v0 of arr(v, q, 100)) {
          const sh = obj(v0, q);
          color(sh.color, q + '.color');
          for (const k of ['x', 'y', 'spread']) num(sh[k], q + '.' + k);
          num(sh.blur, q + '.blur', 0);
        }
      },
      p + '.style',
    );
    optional(
      n,
      'layout',
      (v, q) => {
        const l = obj(v, q);
        en(l.mode, q + '.mode', ['none', 'horizontal', 'vertical', 'grid']);
        num(l.gap, q + '.gap', 0);
        optional(l, 'rowGap', (x, y) => num(x, y, 0), q);
        tuple(l.padding, q + '.padding', 4, 0);
        en(l.align, q + '.align', ['start', 'center', 'end', 'stretch']);
        en(l.justify, q + '.justify', ['start', 'center', 'end', 'space-between']);
        bool(l.wrap, q + '.wrap');
        optional(l, 'columns', (x, y) => integer(x, y, 1), q);
        for (const k of ['widthSizing', 'heightSizing'])
          en(l[k], q + '.' + k, ['fixed', 'fill', 'hug']);
        for (const k of ['minWidth', 'maxWidth']) optional(l, k, (x, y) => num(x, y, 0), q);
        if (l.minWidth !== undefined && l.maxWidth !== undefined && l.minWidth > l.maxWidth)
          fail(q + ' has inverted width limits');
      },
      p,
    );
    optional(n, 'text', text, p);
    if (n.kind === 'text' && !Object.hasOwn(n, 'text')) fail(p + ' text node needs text');
    if (n.kind !== 'text' && Object.hasOwn(n, 'text')) fail(p + ' non-text node has text');
    optional(n, 'assetId', str, p);
    if (n.kind === 'image' || n.kind === 'svg') {
      if (!Object.hasOwn(n, 'assetId') || assets.get(n.assetId) !== n.kind)
        fail(p + ' needs matching asset');
    } else if (Object.hasOwn(n, 'assetId') && !assets.has(n.assetId))
      fail(p + ' references unknown asset');
    optional(
      n,
      'image',
      (v, q) => {
        const im = obj(v, q);
        en(im.fit, q + '.fit', ['fill', 'contain', 'cover', 'none', 'scale-down']);
        tuple(im.position, q + '.position', 2);
        optional(im, 'positionOffset', (v, q) => tuple(v, q, 2), q);
        optional(
          im,
          'contentBox',
          (v, q) => {
            const box = obj(v, q);
            for (const key of ['x', 'y', 'width', 'height']) num(box[key], q + '.' + key, 0);
            if (box.x + box.width > b.width + 0.1 || box.y + box.height > b.height + 0.1)
              fail(q + ' exceeds image bounds');
          },
          q,
        );
        optional(
          im,
          'intrinsicSize',
          (v, q) => {
            const size = obj(v, q);
            num(size.width, q + '.width', 0);
            num(size.height, q + '.height', 0);
          },
          q,
        );
      },
      p,
    );
    optional(n, 'position', (v, q) => en(v, q, ['flow', 'absolute']), p);
    arr(n.children, p + '.children', 12000).forEach((c, i) =>
      node(c, `${p}.children[${i}]`, ids, depth + 1),
    );
  };
  const ss = arr(s.screens, 'screens', 5);
  if (!ss.length) fail('screens must not be empty');
  for (const [i, v] of ss.entries()) {
    const p = `screens[${i}]`,
      screen = obj(v, p);
    str(screen.id, p + '.id');
    if (screens.has(screen.id)) fail(p + ' duplicate screen id');
    const ids = new Set<string>();
    screens.set(screen.id, ids);
    const vp = obj(screen.viewport, p + '.viewport');
    integer(vp.width, p + '.viewport.width', 320, 3840);
    integer(vp.height, p + '.viewport.height', 200, 2160);
    num(vp.dpr, p + '.viewport.dpr', Number.MIN_VALUE, 3);
    optional(
      screen,
      'screenshot',
      (v, q) => {
        base64(v, q);
        validatePngHeader(v as string, q);
      },
      p,
    );
    node(screen.root, p + '.root', ids, 1);
  }
  for (const [i, v] of arr(s.issues, 'issues', 5000).entries()) {
    const p = `issues[${i}]`,
      issue = obj(v, p);
    str(issue.code, p + '.code');
    str(issue.message, p + '.message');
    en(issue.severity, p + '.severity', ['info', 'warning', 'error']);
    optional(issue, 'screenId', str, p);
    optional(issue, 'nodeId', str, p);
    if (Object.hasOwn(issue, 'screenId') && !screens.has(issue.screenId))
      fail(p + ' references unknown screen');
    if (
      Object.hasOwn(issue, 'nodeId') &&
      (!Object.hasOwn(issue, 'screenId') || !screens.get(issue.screenId)?.has(issue.nodeId))
    )
      fail(p + ' references unknown node or lacks screen scope');
  }
  return input as ScenePackage;
}

function validatePngHeader(data: string, path: string): void {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let accumulator = 0,
    bits = 0;
  for (const c of data.slice(0, 44)) {
    if (c === '=') break;
    accumulator = (accumulator << 6) | alphabet.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (bytes.length < 33 || signature.some((v, i) => bytes[i] !== v))
    fail(path + ' must contain a PNG with an IHDR header');
  const read = (offset: number) =>
    bytes[offset]! * 16777216 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!;
  if (read(16) < 1 || read(16) > 32768 || read(20) < 1 || read(20) > 32768)
    fail(path + ' PNG dimensions exceed limits');
}
