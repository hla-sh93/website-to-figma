import type { Bounds } from './scene.js';

export type ImageSpec = {
  fit: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
  position: [number, number];
  positionOffset?: [number, number];
  contentBox?: Bounds;
  intrinsicSize?: { width: number; height: number };
};
type Axis = { fraction: number; pixels: number };
/** Computed single-layer CSS background sizing in the positioning area. */
export function backgroundSize(
  value: string,
  area: { width: number; height: number },
  intrinsic: { width: number; height: number },
): { width: number; height: number } | 'cover' | 'contain' | null {
  if (value === 'cover' || value === 'contain') return value;
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2) return null;
  const axis = (part: string, reference: number): number | null | undefined =>
    part === 'auto'
      ? undefined
      : /^(?:\d*\.)?\d+(px|%)$/.test(part)
        ? parseFloat(part) * (part.endsWith('%') ? reference / 100 : 1)
        : part === '0'
          ? 0
          : null;
  let width = axis(parts[0]!, area.width),
    height = axis(parts[1] ?? 'auto', area.height);
  if (width === null || height === null) return null;
  if (width === undefined && height === undefined) return { ...intrinsic };
  width ??= (intrinsic.width * height!) / intrinsic.height;
  height ??= (intrinsic.height * width) / intrinsic.width;
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : null;
}
/** Parses computed CSS positions, never evaluates CSS or JavaScript expressions. */
export function parseObjectPosition(
  value: string,
): { position: [number, number]; offset: [number, number] } | null {
  if (value.length > 256) return null;
  const tokens =
    value
      .trim()
      .toLowerCase()
      .match(/calc\([^)]*\)|[^\s]+/g) ?? [];
  const component = (token: string, axis: 'x' | 'y'): Axis | null => {
    if (token === 'center') return { fraction: 0.5, pixels: 0 };
    if (token === (axis === 'x' ? 'left' : 'top')) return { fraction: 0, pixels: 0 };
    if (token === (axis === 'x' ? 'right' : 'bottom')) return { fraction: 1, pixels: 0 };
    let expression = token;
    if (expression.startsWith('calc(') && expression.endsWith(')'))
      expression = expression.slice(5, -1).replace(/\s/g, '');
    if (expression === '0') return { fraction: 0, pixels: 0 };
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px)(?:[+-](?:\d+(?:\.\d*)?|\.\d+)(?:%|px))*$/.test(
        expression,
      )
    )
      return null;
    let fraction = 0,
      pixels = 0;
    for (const term of expression.matchAll(/([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%|px)/g)) {
      const number = Number(term[1]);
      if (!Number.isFinite(number)) return null;
      if (term[2] === '%') fraction += number / 100;
      else pixels += number;
    }
    return { fraction, pixels };
  };
  let x: Axis | null = null,
    y: Axis | null = null;
  if (tokens.length === 1) {
    if (['top', 'bottom'].includes(tokens[0]!)) {
      x = component('center', 'x');
      y = component(tokens[0]!, 'y');
    } else {
      x = component(tokens[0]!, 'x');
      y = component('center', 'y');
    }
  } else if (tokens.length === 2) {
    let [first, second] = tokens as [string, string];
    if (['top', 'bottom'].includes(first) || ['left', 'right'].includes(second))
      [first, second] = [second, first];
    x = component(first, 'x');
    y = component(second, 'y');
  } else if (tokens.length === 3 || tokens.length === 4) {
    for (let i = 0; i < tokens.length; i++) {
      const edge = tokens[i]!;
      const axis = ['left', 'right'].includes(edge)
        ? 'x'
        : ['top', 'bottom'].includes(edge)
          ? 'y'
          : null;
      if (!axis) return null;
      const result = component(edge, axis)!;
      const next = tokens[i + 1];
      if (next && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(next)) {
        result.pixels = parseFloat(next) * (['right', 'bottom'].includes(edge) ? -1 : 1);
        i++;
      }
      if (axis === 'x') {
        if (x) return null;
        x = result;
      } else {
        if (y) return null;
        y = result;
      }
    }
  }
  if (!x || !y || ![x.fraction, x.pixels, y.fraction, y.pixels].every(Number.isFinite)) return null;
  return { position: [x.fraction, y.fraction], offset: [x.pixels, y.pixels] };
}

export function computeImagePlacement(
  box: { width: number; height: number },
  asset: { width: number; height: number },
  spec: ImageSpec,
) {
  const content = spec.contentBox ?? { x: 0, y: 0, width: box.width, height: box.height };
  const intrinsic = spec.intrinsicSize ?? asset;
  if (
    ![
      box.width,
      box.height,
      content.x,
      content.y,
      content.width,
      content.height,
      intrinsic.width,
      intrinsic.height,
      ...spec.position,
      ...(spec.positionOffset ?? [0, 0]),
    ].every(Number.isFinite) ||
    intrinsic.width <= 0 ||
    intrinsic.height <= 0 ||
    content.width < 0 ||
    content.height < 0
  )
    throw new Error('Invalid image placement dimensions.');
  let width = content.width,
    height = content.height;
  if (spec.fit !== 'fill') {
    const contain = Math.min(content.width / intrinsic.width, content.height / intrinsic.height);
    const scale =
      spec.fit === 'cover'
        ? Math.max(content.width / intrinsic.width, content.height / intrinsic.height)
        : spec.fit === 'none'
          ? 1
          : spec.fit === 'scale-down'
            ? Math.min(1, contain)
            : contain;
    width = intrinsic.width * scale;
    height = intrinsic.height * scale;
  }
  return {
    x: content.x + (content.width - width) * spec.position[0] + (spec.positionOffset?.[0] ?? 0),
    y: content.y + (content.height - height) * spec.position[1] + (spec.positionOffset?.[1] ?? 0),
    width,
    height,
    content: { ...content },
  };
}
