import type { Gradient, RGBA, Shadow } from '../core/scene.js';

/** Affine transform in Figma's [[a, c, e], [b, d, f]] layout. */
export type Affine = [[number, number, number], [number, number, number]];

export function invertAffine(m: Affine): Affine {
  const [[a, c, e], [b, d, f]] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('Degenerate gradient.');
  return [
    [d / det, -c / det, (c * f - d * e) / det],
    [-b / det, a / det, (b * e - a * f) / det],
  ];
}

/**
 * Figma gradient space runs from (0, 0.5) to (1, 0.5) for linear gradients and
 * centres radial/angular gradients at (0.5, 0.5) with radius 0.5. The paint's
 * gradientTransform maps the layer's unit square into that space, so build the
 * gradient-to-layer mapping and invert it.
 */
export function gradientTransform(g: Gradient, width: number, height: number): Affine {
  const w = Math.max(width, 0.01),
    h = Math.max(height, 0.01);
  if (g.kind === 'linear') {
    const [x0, y0] = g.from,
      [x1, y1] = g.to;
    const ax = x1 - x0,
      ay = y1 - y0;
    // Perpendicular axis with the same pixel length keeps the layer's aspect ratio.
    const bx = (-ay * h) / w,
      by = (ax * w) / h;
    return invertAffine([
      [ax, bx, x0 - bx / 2],
      [ay, by, y0 - by / 2],
    ]);
  }
  const [cx, cy] = g.from;
  const [rx, ry] = g.radius ?? [0.5, 0.5];
  const angle = g.kind === 'conic' ? (((g.angle ?? 0) - 90) * Math.PI) / 180 : 0;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  // Rotate the axes in pixel space, then return to unit space.
  const ax = (2 * rx * w * cos) / w,
    ay = (2 * rx * w * sin) / h,
    bx = (-2 * ry * h * sin) / w,
    by = (2 * ry * h * cos) / h;
  return invertAffine([
    [ax, bx, cx - ax / 2 - bx / 2],
    [ay, by, cy - ay / 2 - by / 2],
  ]);
}

export function gradientPaint(g: Gradient, width: number, height: number): GradientPaint {
  return {
    type:
      g.kind === 'linear'
        ? 'GRADIENT_LINEAR'
        : g.kind === 'radial'
          ? 'GRADIENT_RADIAL'
          : 'GRADIENT_ANGULAR',
    gradientTransform: gradientTransform(g, width, height),
    gradientStops: g.stops.map((stop) => ({
      position: Math.min(1, Math.max(0, stop.position)),
      color: { ...stop.color },
    })),
  };
}

export function shadowEffect(shadow: Shadow, text = false): Effect {
  const base = {
    color: { ...shadow.color },
    offset: { x: shadow.x, y: shadow.y },
    // CSS blur radius is twice the Gaussian deviation; Figma's radius matches it.
    radius: shadow.blur,
    spread: text ? 0 : shadow.spread,
    visible: true,
    blendMode: 'NORMAL' as const,
  };
  return shadow.inset
    ? ({ ...base, type: 'INNER_SHADOW' } as InnerShadowEffect)
    : ({ ...base, type: 'DROP_SHADOW', showShadowBehindNode: false } as DropShadowEffect);
}

/** CSS blur(σ) is a Gaussian deviation; Figma's blur radius is about twice that. */
export function blurEffect(kind: 'LAYER_BLUR' | 'BACKGROUND_BLUR', deviation: number): Effect {
  return {
    type: kind,
    blurType: 'NORMAL',
    radius: Math.max(0, deviation * 2),
    visible: true,
  } as BlurEffect;
}

/** Fast UTF-8 decoding without TextDecoder, which the main sandbox lacks. */
export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  const units: number[] = [];
  const flush = () => {
    parts.push(String.fromCharCode(...units));
    units.length = 0;
  };
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i]!;
    let code = 0xfffd,
      size = 1;
    if (byte < 0x80) code = byte;
    else if (byte >= 0xc2 && byte < 0xe0 && i + 1 < bytes.length) {
      code = ((byte & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      size = 2;
    } else if (byte >= 0xe0 && byte < 0xf0 && i + 2 < bytes.length) {
      code = ((byte & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      size = 3;
    } else if (byte >= 0xf0 && byte < 0xf5 && i + 3 < bytes.length) {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      size = 4;
    }
    i += size;
    if (code > 0xffff) {
      code -= 0x10000;
      units.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else units.push(code);
    if (units.length > 8000) flush();
  }
  flush();
  return parts.join('');
}

export const colorName = (c: RGBA) => {
  const hex = [c.r, c.g, c.b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  return c.a >= 0.999 ? `#${hex}` : `#${hex} ${Math.round(c.a * 100)}%`;
};
