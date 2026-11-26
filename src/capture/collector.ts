import type { SceneNode, SceneIssue } from '../core/scene.js';
export type CaptureAssetSource = {
  nodeId: string;
  kind: 'image' | 'svg';
  url: string;
  width: number;
  height: number;
  objectPosition?: string;
  mediaFrame?: boolean;
  background?: { size: string; repeat: string };
};
/** Executed in Chromium. All coordinates remain in the source document space. */
export function collect(selector: string | undefined): {
  root: SceneNode;
  issues: SceneIssue[];
  sources: CaptureAssetSource[];
  textSources: { nodeId: string; selector: string }[];
  tokens: { name: string; value: { r: number; g: number; b: number; a: number } }[];
} {
  const issues: SceneIssue[] = [],
    sources: CaptureAssetSource[] = [];
  const textSources: { nodeId: string; selector: string }[] = [];
  let count = 0;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })!;
  const colorCache = new Map<string, { r: number; g: number; b: number; a: number }>();
  const color = (s: string) => {
    const cached = colorCache.get(s);
    if (cached) return cached;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = s;
    colorContext.fillRect(0, 0, 1, 1);
    const values = colorContext.getImageData(0, 0, 1, 1).data;
    const value = {
      r: values[0]! / 255,
      g: values[1]! / 255,
      b: values[2]! / 255,
      a: values[3]! / 255,
    };
    colorCache.set(s, value);
    return value;
  };
  const px = (s: string) => parseFloat(s) || 0;
  const NODE_BUDGET = 4000,
    DEPTH_BUDGET = 100,
    RASTER_BUDGET = 60;
  let rasters = 0,
    omitted = 0;
  /** Nodes captured as screenshots: their pixels already include any transform. */
  const flattened = new Set<string>();
  type RGBA = { r: number; g: number; b: number; a: number };
  type Shadow = {
    color: RGBA;
    x: number;
    y: number;
    blur: number;
    spread: number;
    inset?: boolean;
  };
  type Gradient = NonNullable<SceneNode['style']['gradients']>[number];
  /** Splits a CSS list on top-level separators, ignoring those inside parentheses. */
  const splitTop = (value: string, separator: ',' | ' ') => {
    const parts: string[] = [];
    let depth = 0,
      token = '';
    for (const ch of value) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === separator && depth === 0) {
        if (token.trim()) parts.push(token.trim());
        token = '';
      } else token += ch;
    }
    if (token.trim()) parts.push(token.trim());
    return parts;
  };
  const isColor = (value: string) => {
    if (!value || /^-?[\d.]/.test(value)) return false;
    colorContext.fillStyle = '#010203';
    colorContext.fillStyle = value;
    return colorContext.fillStyle !== '#010203' || /^#010203$/i.test(value);
  };
  const shadows = (value: string, allowInset: boolean): Shadow[] | null => {
    if (!value || value === 'none') return [];
    const result: Shadow[] = [];
    for (const layer of splitTop(value, ',')) {
      const tokens = splitTop(layer, ' ');
      const inset = tokens.includes('inset');
      if (inset && !allowInset) return null;
      const colorToken = tokens.find((t) => t !== 'inset' && isColor(t));
      const lengths = tokens.filter((t) => t !== 'inset' && t !== colorToken).map(px);
      if (lengths.length < 2 || lengths.length > 4) return null;
      result.push({
        color: color(colorToken ?? 'currentcolor'),
        x: lengths[0]!,
        y: lengths[1]!,
        blur: Math.max(0, lengths[2] ?? 0),
        spread: lengths[3] ?? 0,
        ...(inset ? { inset: true } : {}),
      });
    }
    return result;
  };
  /** Resolves one CSS gradient layer to unit-space geometry in a w × h box. */
  const gradient = (layer: string, w: number, h: number): Gradient | null => {
    const match = layer.match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
    if (!match || w <= 0 || h <= 0) return null;
    const kind = match[2] as 'linear' | 'radial' | 'conic';
    const args = splitTop(match[3]!, ',');
    let config = '';
    if (args.length && !isColor(splitTop(args[0]!, ' ')[0]!)) config = args.shift()!;
    const angleOf = (token: string) => {
      const value = parseFloat(token);
      return token.endsWith('grad')
        ? value * 0.9
        : token.endsWith('rad')
          ? (value * 180) / Math.PI
          : token.endsWith('turn')
            ? value * 360
            : value;
    };
    const point = (tokens: string[]): [number, number] => {
      let x = w / 2,
        y = h / 2;
      const words = tokens.length === 1 ? [tokens[0]!, 'center'] : tokens.slice(0, 2);
      if (/^(top|bottom)$/.test(words[0]!) || /^(left|right)$/.test(words[1]!)) words.reverse();
      const axis = (token: string, size: number) =>
        token === 'left' || token === 'top'
          ? 0
          : token === 'right' || token === 'bottom'
            ? size
            : token === 'center'
              ? size / 2
              : token.endsWith('%')
                ? (parseFloat(token) / 100) * size
                : px(token);
      x = axis(words[0]!, w);
      y = axis(words[1]!, h);
      return [x, y];
    };
    let from: [number, number],
      to: [number, number],
      radius: [number, number] | undefined,
      angle: number | undefined,
      length: number;
    const configTokens = splitTop(config, ' ');
    if (kind === 'linear') {
      let dx = 0,
        dy = 1;
      if (configTokens[0] === 'to') {
        const sx = configTokens.includes('right') ? 1 : configTokens.includes('left') ? -1 : 0,
          sy = configTokens.includes('bottom') ? 1 : configTokens.includes('top') ? -1 : 0;
        [dx, dy] = sx && sy ? [sx * h, sy * w] : [sx, sy];
      } else if (configTokens[0]) {
        const theta = (angleOf(configTokens[0]) * Math.PI) / 180;
        [dx, dy] = [Math.sin(theta), -Math.cos(theta)];
      }
      const norm = Math.hypot(dx, dy) || 1;
      dx /= norm;
      dy /= norm;
      length = Math.abs(w * dx) + Math.abs(h * dy);
      from = [(w / 2 - (dx * length) / 2) / w, (h / 2 - (dy * length) / 2) / h];
      to = [(w / 2 + (dx * length) / 2) / w, (h / 2 + (dy * length) / 2) / h];
    } else {
      const at = configTokens.indexOf('at');
      const center =
        at >= 0 ? point(configTokens.slice(at + 1)) : ([w / 2, h / 2] as [number, number]);
      const shapeTokens = at >= 0 ? configTokens.slice(0, at) : configTokens;
      if (kind === 'conic') {
        const fromIndex = shapeTokens.indexOf('from');
        angle = fromIndex >= 0 ? angleOf(shapeTokens[fromIndex + 1] ?? '0deg') : 0;
        const r = Math.max(w, h);
        radius = [r / w, r / h];
        length = 360;
      } else {
        const [cx, cy] = center;
        const sides = [cx, w - cx, cy, h - cy];
        const circle =
          shapeTokens.includes('circle') ||
          (shapeTokens.filter((t) => /px|%/.test(t)).length === 1 &&
            !shapeTokens.includes('ellipse'));
        const keyword =
          shapeTokens.find((t) => /^(closest|farthest)-(side|corner)$/.test(t)) ??
          'farthest-corner';
        const explicit = shapeTokens.filter((t) => /^-?[\d.]+(px|%)$/.test(t));
        let rx: number, ry: number;
        if (explicit.length) {
          rx = explicit[0]!.endsWith('%') ? (parseFloat(explicit[0]!) / 100) * w : px(explicit[0]!);
          ry = explicit[1]
            ? explicit[1].endsWith('%')
              ? (parseFloat(explicit[1]) / 100) * h
              : px(explicit[1])
            : rx;
        } else {
          const fx = keyword.startsWith('farthest')
              ? Math.max(sides[0]!, sides[1]!)
              : Math.min(sides[0]!, sides[1]!),
            fy = keyword.startsWith('farthest')
              ? Math.max(sides[2]!, sides[3]!)
              : Math.min(sides[2]!, sides[3]!);
          if (circle) {
            const r = keyword.endsWith('corner')
              ? Math.hypot(fx, fy)
              : keyword.startsWith('farthest')
                ? Math.max(...sides)
                : Math.min(...sides);
            rx = ry = r;
          } else if (keyword.endsWith('corner')) {
            rx = fx * Math.SQRT2;
            ry = fy * Math.SQRT2;
          } else {
            rx = fx;
            ry = fy;
          }
        }
        rx = Math.max(rx, 0.01);
        ry = Math.max(ry, 0.01);
        radius = [rx / w, ry / h];
        length = rx;
      }
      from = [center[0] / w, center[1] / h];
      to = [center[0] / w + radius[0], center[1] / h];
    }
    const stops: { position?: number; color: RGBA }[] = [];
    for (const arg of args) {
      const tokens = splitTop(arg, ' ');
      const positions: string[] = [];
      while (tokens.length > 1 && /^-?[\d.]+(%|px|deg|turn|rad|grad)?$/.test(tokens.at(-1)!))
        positions.unshift(tokens.pop()!);
      const value = tokens.join(' ');
      if (!isColor(value)) continue; // colour hints are approximated by linear interpolation
      const toUnit = (token: string) =>
        token.endsWith('%')
          ? parseFloat(token) / 100
          : kind === 'conic'
            ? angleOf(token) / 360
            : px(token) / length;
      const rgba = color(value);
      if (!positions.length) stops.push({ color: rgba });
      for (const position of positions) stops.push({ color: rgba, position: toUnit(position) });
    }
    if (stops.length < 2) return null;
    stops[0]!.position ??= 0;
    stops.at(-1)!.position ??= 1;
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i]!.position !== undefined) continue;
      let j = i;
      while (stops[j]!.position === undefined) j++;
      const start = stops[i - 1]!.position!,
        end = stops[j]!.position!;
      for (let k = i; k < j; k++)
        stops[k]!.position = start + ((end - start) * (k - i + 1)) / (j - i + 1);
    }
    let previous = 0;
    return {
      kind,
      from,
      to,
      ...(radius ? { radius } : {}),
      ...(angle !== undefined ? { angle } : {}),
      stops: stops.map((stop) => {
        previous = Math.min(1, Math.max(previous, stop.position!, 0));
        return { position: previous, color: stop.color };
      }),
    };
  };
  /** Paint-level style shared by elements and positioned pseudo-elements. */
  const boxStyle = (c: CSSStyleDeclaration, w: number, h: number, id: string) => {
    const style: SceneNode['style'] = {
      opacity: px(c.opacity),
      background: color(c.backgroundColor),
      radius: [
        px(c.borderTopLeftRadius),
        px(c.borderTopRightRadius),
        px(c.borderBottomRightRadius),
        px(c.borderBottomLeftRadius),
      ],
    };
    const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => {
      const lineStyle = c.getPropertyValue(`border-${side.toLowerCase()}-style`);
      return {
        width: ['none', 'hidden'].includes(lineStyle)
          ? 0
          : px(c.getPropertyValue(`border-${side.toLowerCase()}-width`)),
        color: c.getPropertyValue(`border-${side.toLowerCase()}-color`),
        lineStyle,
      };
    });
    const visible = sides.filter((side) => side.width > 0);
    if (visible.length) {
      const widest = visible.reduce((a, b) => (b.width > a.width ? b : a));
      const uniform = visible.length === 4 && visible.every((side) => side.width === widest.width);
      style.border = {
        color: color(widest.color),
        width: widest.width,
        ...(uniform
          ? {}
          : { sides: sides.map((side) => side.width) as [number, number, number, number] }),
        ...(widest.lineStyle === 'dashed' || widest.lineStyle === 'dotted'
          ? { dash: widest.lineStyle as 'dashed' | 'dotted' }
          : {}),
      };
      if (new Set(visible.map((side) => side.color)).size > 1)
        issue(
          id,
          'border-colors-merged',
          'Different border colours per side use the widest side colour.',
        );
    }
    const boxShadows = shadows(c.boxShadow, true);
    if (boxShadows === null)
      issue(id, 'unsupported-effect', 'Shadow syntax is not represented by editable style.');
    else if (boxShadows.length) style.shadow = boxShadows;
    // Filters Figma can represent: layer blur, and colour filters on image paints.
    if (c.filter !== 'none') {
      const amount = (value: string) =>
        value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
      const filters: NonNullable<SceneNode['style']['imageFilters']> = {};
      let supported = true;
      for (const [, fn, arg] of c.filter.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        if (fn === 'blur') style.blur = px(arg!);
        else if (fn === 'grayscale')
          filters.saturation = Math.max(-1, (filters.saturation ?? 0) - Math.min(1, amount(arg!)));
        else if (fn === 'saturate')
          filters.saturation = Math.max(
            -1,
            Math.min(1, (filters.saturation ?? 0) + amount(arg!) - 1),
          );
        else if (fn === 'contrast') filters.contrast = Math.max(-1, Math.min(1, amount(arg!) - 1));
        else if (fn === 'brightness')
          filters.exposure = Math.max(-1, Math.min(1, amount(arg!) - 1));
        else supported = false;
      }
      if (Object.keys(filters).length) style.imageFilters = filters;
      if (!supported)
        issue(
          id,
          'unsupported-effect',
          'CSS filter other than blur and colour adjustments is visible only in the screenshot.',
        );
    }
    const backdrop =
      (c as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter ?? 'none';
    const backdropBlur = backdrop.match(/^blur\(([\d.]+)px\)$/);
    if (backdropBlur) style.backdropBlur = px(backdropBlur[1]!);
    else if (backdrop !== 'none')
      issue(id, 'unsupported-effect', 'Backdrop filter other than blur is not represented.');
    // Background layers: CSS lists the topmost first; the background colour sits under all.
    let url: string | undefined,
      urlIndex = -1;
    const above: Gradient[] = [],
      below: Gradient[] = [];
    const layers = c.backgroundImage === 'none' ? [] : splitTop(c.backgroundImage, ',');
    const sizes = splitTop(c.backgroundSize, ',');
    layers.forEach((layer, index) => {
      const urlMatch = layer.match(/^url\("((?:\\.|[^"\\])*)"\)$/s);
      if (urlMatch) {
        if (url !== undefined) {
          issue(id, 'unsupported-effect', 'Only one background image layer is editable.');
          return;
        }
        url = urlMatch[1]!.replace(
          /\\([0-9a-f]{1,6})\s?|\\(.)/gi,
          (_m, hex: string | undefined, escaped: string) =>
            hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16))) : escaped,
        );
        urlIndex = index;
        return;
      }
      const g = gradient(layer, w, h);
      if (!g) {
        issue(id, 'unsupported-effect', 'Background layer is not represented by editable style.');
        return;
      }
      const size = (sizes[index] ?? sizes[0] ?? 'auto').trim();
      if (!/^(auto|auto auto|100% 100%|cover)$/.test(size) || layer.startsWith('repeating-'))
        issue(id, 'gradient-approximate', 'Sized or repeating gradient drawn once across the box.');
      (url === undefined ? above : below).push(g);
    });
    return { style, url, urlIndex, above, below };
  };
  /** Clockwise rotation (degrees) and scale from a computed transform matrix. */
  const rotationOf = (transform: string) => {
    const m = transform.match(/^matrix\(([^)]+)\)$/);
    if (!m) return null;
    const [a, b, c2, d] = m[1]!.split(',').map(Number) as [number, number, number, number];
    const sx = Math.hypot(a, b);
    if (!sx) return null;
    const sy = (a * d - b * c2) / sx;
    if (Math.abs((a * c2 + b * d) / (sx * sx)) > 0.01) return null; // skew
    const snap = (v: number) => (Math.abs(Math.abs(v) - 1) < 1e-3 ? Math.sign(v) : v);
    return { rotation: (Math.atan2(b, a) * 180) / Math.PI, sx: snap(sx), sy: snap(sy) };
  };
  const contentString = (value: string) => {
    const parts = value.match(/"(?:\\.|[^"\\])*"/g);
    if (!parts || parts.join(' ').length !== value.trim().length) return null;
    return parts.map((part) => part.slice(1, -1).replace(/\\(.)/g, '$1')).join('');
  };
  // Icon fonts are not installed in Figma; their glyphs are drawn to a sharp image instead.
  const ICON_FONT =
    /awesome|material (?:icons|symbols)|icomoon|ionicons|bootstrap-icons|remixicon|glyphicons|dashicons|feather|fontello|themify|simple-line-icons|boxicons|phosphor|tabler|icofont|flaticon|lineicons|unicons/i;
  const PRIVATE_USE = /^[\uE000-\uF8FF\s]+$/;
  const iconGlyph = (el: Element, c: CSSStyleDeclaration, r: DOMRect): string | null => {
    if (el.children.length || r.width > 128 || r.height > 128) return null;
    const parts: { text: string; style: CSSStyleDeclaration }[] = [];
    for (const which of ['::before', '::after'] as const) {
      const ps = getComputedStyle(el, which);
      const value = contentString(ps.content);
      if (value) parts.push({ text: value, style: ps });
    }
    const own = (el.textContent ?? '').trim();
    if (own) parts.push({ text: own, style: c });
    if (
      !parts.length ||
      !parts.every((p) => ICON_FONT.test(p.style.fontFamily) || PRIVATE_USE.test(p.text))
    )
      return null;
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    for (const p of parts) {
      const s = p.style;
      context.font = `${s.fontStyle} ${s.fontWeight} ${px(s.fontSize) * scale}px ${s.fontFamily}`;
      context.fillStyle = s.color;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(p.text, canvas.width / 2, canvas.height / 2);
    }
    return canvas.toDataURL('image/png');
  };
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    for (let current: Element | null = el; current; current = current.parentElement) {
      const index = current.parentElement
        ? [...current.parentElement.children].indexOf(current) + 1
        : 1;
      parts.unshift(current.tagName.toLowerCase() + `:nth-child(${index})`);
    }
    return parts.join(' > ');
  };
  const variations = (c: CSSStyleDeclaration) => {
    const axes: Record<string, number> = {};
    for (const match of c.fontVariationSettings.matchAll(
      /["']([\x20-\x7e]{4})["']\s+(-?(?:\d*\.)?\d+)/g,
    )) {
      if (Object.keys(axes).length >= 16) break;
      axes[match[1]!] = Number(match[2]);
    }
    return Object.keys(axes).length ? axes : undefined;
  };
  const decoration = (el: Element): 'none' | 'underline' | 'strikethrough' => {
    // Decorations propagate through inline descendants without CSS inheritance.
    let underline = false,
      strike = false;
    for (let current: Element | null = el; current; current = current.parentElement) {
      const line = getComputedStyle(current).textDecorationLine;
      underline ||= line.includes('underline');
      strike ||= line.includes('line-through');
      if (current !== el && !getComputedStyle(current).display.startsWith('inline')) break;
    }
    return underline ? 'underline' : strike ? 'strikethrough' : 'none';
  };
  const lineCache = new Map<string, number>();
  const lineHeight = (c: CSSStyleDeclaration, characters: string) => {
    if (c.lineHeight !== 'normal') return px(c.lineHeight);
    const sample = characters.replace(/[\r\n]/g, ' ').slice(0, 256) || 'Hg';
    const key = [
      c.fontFamily,
      c.fontSize,
      c.fontStyle,
      c.fontWeight,
      c.fontVariationSettings,
      sample,
    ].join('|');
    const known = lineCache.get(key);
    if (known !== undefined) return known;
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:fixed;left:-10000px;top:0;visibility:hidden;display:inline-block;padding:0;border:0;margin:0;white-space:pre;line-height:normal;';
    for (const name of [
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'font-stretch',
      'font-variation-settings',
      'font-feature-settings',
    ])
      probe.style.setProperty(name, c.getPropertyValue(name));
    probe.textContent = sample;
    document.documentElement.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    lineCache.set(key, height);
    return height;
  };
  const alignment = (c: CSSStyleDeclaration): 'left' | 'right' | 'center' | 'justify' =>
    c.textAlign === 'center'
      ? 'center'
      : c.textAlign === 'justify'
        ? 'justify'
        : c.textAlign === 'right' ||
            (c.textAlign === 'start' && c.direction === 'rtl') ||
            (c.textAlign === 'end' && c.direction !== 'rtl')
          ? 'right'
          : 'left';
  const issue = (id: string, code: string, message: string) => {
    if (issues.length < 900) issues.push({ code, severity: 'warning', message, nodeId: id });
  };
  const hidden = (el: Element, c = getComputedStyle(el)) => {
    const r = el.getBoundingClientRect();
    const clip = c.clip.match(/-?\d+(?:\.\d+)?(?=px)/g)?.map(Number);
    const emptyClip =
      ['absolute', 'fixed'].includes(c.position) &&
      clip?.length === 4 &&
      (clip[1]! <= clip[3]! || clip[2]! <= clip[0]!);
    return (
      emptyClip ||
      c.display === 'none' ||
      c.visibility === 'hidden' ||
      c.contentVisibility === 'hidden' ||
      Number(c.opacity) === 0 ||
      (r.width <= 1 &&
        r.height <= 1 &&
        (c.clip !== 'auto' || c.clipPath !== 'none') &&
        c.display !== 'contents')
    );
  };
  const preservesSpaces = (c: CSSStyleDeclaration) =>
    c.whiteSpace.startsWith('pre') || c.whiteSpace === 'break-spaces';
  // Characters stay as authored; Figma applies the case so later edits keep it.
  const transformedText = (value: string, _c: CSSStyleDeclaration) => value;
  const textCase = (c: CSSStyleDeclaration): { textCase?: 'upper' | 'lower' | 'title' } =>
    c.textTransform === 'uppercase'
      ? { textCase: 'upper' }
      : c.textTransform === 'lowercase'
        ? { textCase: 'lower' }
        : c.textTransform === 'capitalize'
          ? { textCase: 'title' }
          : {};
  const textShadow = (c: CSSStyleDeclaration) => {
    const list = shadows(c.textShadow, false);
    return list?.length ? { shadow: list } : {};
  };
  /** Replaces an element beyond the node/depth budget with a measured image. */
  const raster = (el: Element, r: DOMRect, id: string): SceneNode | null => {
    if (rasters >= RASTER_BUDGET) {
      omitted++;
      return null;
    }
    rasters++;
    flattened.add(id);
    sources.push({
      nodeId: id,
      kind: 'image',
      url: 'frame:raster',
      width: r.width,
      height: r.height,
      mediaFrame: true,
    });
    issue(id, 'raster-fallback', 'Deeply nested or very large content imported as an image.');
    return {
      id,
      name: 'Image / ' + (el.getAttribute('aria-label') || el.tagName.toLowerCase()).slice(0, 80),
      kind: 'image',
      source: { tag: el.tagName.toLowerCase(), key: id },
      bounds: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
      style: { opacity: 1 },
      image: { fit: 'fill', position: [0.5, 0.5] },
      position: 'flow',
      children: [],
    };
  };
  // Lines as laid out by the browser: client rects that start a new row.
  // A range that holds a whole inline-block reports that box as one rectangle, however
  // many lines it has inside, so the rectangles are read from the text nodes themselves.
  const lineCount = (range: Range): number => {
    const root = range.commonAncestorContainer;
    const nodes: Node[] = [];
    if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
    else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode())
        if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    }
    const own = document.createRange();
    let lines = 0,
      bottom = -Infinity;
    for (const node of nodes) {
      own.selectNodeContents(node);
      for (const rect of own.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        if (rect.top >= bottom - rect.height / 2) lines++;
        bottom = Math.max(bottom, rect.bottom);
      }
    }
    return Math.max(1, lines);
  };
  // Where the browser started each line, as offsets in the collected characters.
  // Words are matched by the count of non-space characters before them, which does not
  // depend on how white space was collapsed; text the page generates (pseudo-elements)
  // makes the counts differ, and then no breaks are recorded.
  const lineBreaks = (root: Node, characters: string, lines: number): { breaks?: number[] } => {
    if (lines < 2 || characters.length > 6000) return {};
    const nodes: Text[] = [];
    if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
    else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    }
    const range = document.createRange();
    const starts: number[] = [];
    let inked = 0,
      bottom = -Infinity,
      started = false;
    for (const node of nodes)
      for (const word of node.data.matchAll(/\S+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + 1);
        const rect = range.getClientRects()[0];
        if (!rect || !rect.height) continue; // not rendered
        if (started && rect.top >= bottom - rect.height / 2) starts.push(inked);
        started = true;
        bottom = Math.max(bottom, rect.bottom);
        inked += word[0].length;
      }
    if (!starts.length || characters.replace(/\s/g, '').length !== inked) return {};
    const breaks: number[] = [];
    let seen = 0,
      next = 0;
    for (let i = 0; i < characters.length && next < starts.length; i++) {
      if (/\s/.test(characters[i]!)) continue;
      if (seen === starts[next]) {
        breaks.push(i);
        next++;
      }
      seen++;
    }
    return breaks.length === starts.length ? { breaks } : {};
  };
  const measuredText = (el: Element, node: Node, id: string): SceneNode | null => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return null;
    const c = getComputedStyle(el);
    if (hidden(el, c)) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const b = range.getBoundingClientRect();
    if (!b.width || !b.height || b.y + scrollY >= 16000) return null;
    const characters = transformedText(
      preservesSpaces(c) ? node.textContent : node.textContent.replace(/\s+/g, ' ').trim(),
      c,
    );
    textSources.push({ nodeId: id, selector: cssPath(el) });
    return {
      id,
      name: 'text',
      kind: 'text',
      source: { tag: '#text' },
      bounds: { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height },
      style: { opacity: 1 },
      children: [],
      position: 'flow',
      text: {
        characters,
        fontFamily: c.fontFamily,
        fontStyle: c.fontStyle,
        fontWeight: px(c.fontWeight) || 400,
        fontSize: px(c.fontSize),
        lineHeight: lineHeight(c, characters),
        textDecoration: decoration(el),
        ...(variations(c) ? { variationSettings: variations(c) } : {}),
        letterSpacing: px(c.letterSpacing),
        color: color(c.color),
        align: alignment(c),
        direction: c.direction === 'rtl' ? 'rtl' : 'ltr',
        sizing: 'inline',
        lines: lineCount(range),
        ...lineBreaks(node, characters, lineCount(range)),
        ...textCase(c),
        ...textShadow(c),
      },
    };
  };
  const childNodes = (
    el: Element,
    path: string,
    depth: number,
    includeDirect = false,
  ): SceneNode[] => {
    if (depth > DEPTH_BUDGET) {
      // Too deep for editable layers: keep each visible child as a measured image.
      return [...el.children].flatMap((child, index) => {
        const c = getComputedStyle(child),
          r = child.getBoundingClientRect();
        if (hidden(child, c) || !r.width || !r.height) return [];
        const node = raster(child, r, path + '/' + index);
        return node ? [node] : [];
      });
    }
    return [...el.childNodes].flatMap((child, index): SceneNode[] => {
      if (!(child instanceof Element)) {
        const text = includeDirect ? measuredText(el, child, path + '/direct-' + index) : null;
        if (text) count++;
        return text ? [text] : [];
      }
      const c = getComputedStyle(child),
        r = child.getBoundingClientRect();
      if (hidden(child, c)) return [];
      const childPath = path + '/' + [...el.children].indexOf(child);
      if (!r.width || !r.height || c.display === 'contents') {
        count++;
        if (
          c.display !== 'contents' &&
          ((!r.width && c.overflowX !== 'visible') || (!r.height && c.overflowY !== 'visible'))
        )
          return [];
        return childNodes(child, childPath, depth + 1, true);
      }
      const node = build(child, childPath, depth);
      return node ? [node] : [];
    });
  };
  /** Builds a layer for a measurable ::before/::after box, 'empty' when it paints nothing. */
  const pseudoBox = (
    el: Element,
    c: CSSStyleDeclaration,
    r: DOMRect,
    ps: CSSStyleDeclaration,
    which: 'before' | 'after',
    id: string,
    text: string | null,
  ): SceneNode | null | 'empty' => {
    const w = px(ps.width),
      h = px(ps.height);
    const positioned = ps.position === 'absolute' || ps.position === 'fixed';
    const nodeId = id + '/' + which;
    const box = boxStyle(ps, Math.max(w, 1), Math.max(h, 1), nodeId);
    const paints =
      (box.style.background?.a ?? 0) > 0 ||
      box.above.length > 0 ||
      box.below.length > 0 ||
      !!box.url ||
      !!box.style.border ||
      !!box.style.shadow?.length;
    if (!paints && !text?.trim()) return 'empty';
    if (!(w > 0 && h > 0)) return null;
    const bl = px(c.borderLeftWidth),
      bt = px(c.borderTopWidth);
    let x: number, y: number;
    if (positioned) {
      if (ps.position === 'absolute' && c.position === 'static') return null;
      x = ps.position === 'fixed' ? px(ps.left) : r.left + scrollX + bl + px(ps.left);
      y = ps.position === 'fixed' ? px(ps.top) : r.top + scrollY + bt + px(ps.top);
      x += px(ps.marginLeft);
      y += px(ps.marginTop);
    } else {
      // A block-level pseudo box in a block container sits at the content edge.
      if (
        !/^(block|list-item|flow-root)$/.test(c.display) ||
        !/^(block|inline-block|flex|grid)$/.test(ps.display)
      )
        return null;
      const rtl = c.direction === 'rtl';
      const contentLeft = r.left + scrollX + bl + px(c.paddingLeft),
        contentRight = r.right + scrollX - px(c.borderRightWidth) - px(c.paddingRight);
      x = rtl ? contentRight - w - px(ps.marginRight) : contentLeft + px(ps.marginLeft);
      y =
        which === 'before'
          ? r.top + scrollY + bt + px(c.paddingTop) + px(ps.marginTop)
          : r.bottom +
            scrollY -
            px(c.borderBottomWidth) -
            px(c.paddingBottom) -
            h -
            px(ps.marginBottom);
    }
    const style: SceneNode['style'] = {
      ...box.style,
      zIndex: ps.zIndex === 'auto' ? 0 : parseInt(ps.zIndex, 10) || 0,
      ...(box.above.length || box.below.length ? { gradients: [...box.above, ...box.below] } : {}),
    };
    let bounds = { x, y, width: w, height: h };
    if (ps.transform !== 'none') {
      const m = ps.transform.match(/^matrix\(([^)]+)\)$/);
      const t = rotationOf(ps.transform);
      if (!m || !t) return null;
      const values = m[1]!.split(',').map(Number);
      const tx = values[4] ?? 0,
        ty = values[5] ?? 0;
      const origin = ps.transformOrigin.split(' ').map(px);
      const ox = origin[0] ?? w / 2,
        oy = origin[1] ?? h / 2;
      // Map the box centre through the transform about its origin.
      const [a, b, c2, d] = values as [number, number, number, number];
      const cx0 = w / 2 - ox,
        cy0 = h / 2 - oy;
      const cx = x + ox + a * cx0 + c2 * cy0 + tx,
        cy = y + oy + b * cx0 + d * cy0 + ty;
      const sw = w * t.sx,
        sh = h * Math.abs(t.sy);
      const theta = (t.rotation * Math.PI) / 180;
      const W = Math.abs(sw * Math.cos(theta)) + Math.abs(sh * Math.sin(theta)),
        H = Math.abs(sw * Math.sin(theta)) + Math.abs(sh * Math.cos(theta));
      bounds = { x: cx - W / 2, y: cy - H / 2, width: W, height: H };
      if (Math.abs(t.rotation) >= 0.5) {
        style.rotation = t.rotation;
        style.size = { width: sw, height: sh };
      }
    }
    const node: SceneNode = {
      id: nodeId,
      name: 'Decoration / ' + which,
      kind: 'frame',
      source: { tag: '::' + which },
      bounds,
      style,
      position: 'absolute',
      children: [],
    };
    if (box.url && !box.above.length && !box.below.length) {
      node.kind = 'image';
      node.image = {
        fit: 'none',
        position: [0, 0],
        contentBox: { x: 0, y: 0, width: bounds.width, height: bounds.height },
      };
      sources.push({
        nodeId,
        kind: 'image',
        url: box.url,
        width: 0,
        height: 0,
        objectPosition: ps.backgroundPosition,
        background: { size: ps.backgroundSize, repeat: ps.backgroundRepeat },
      });
      return node;
    }
    if (text?.trim()) {
      const spec: NonNullable<SceneNode['text']> = {
        characters: text,
        fontFamily: ps.fontFamily,
        fontStyle: ps.fontStyle,
        fontWeight: px(ps.fontWeight) || 400,
        fontSize: px(ps.fontSize),
        lineHeight: lineHeight(ps, text),
        letterSpacing: px(ps.letterSpacing),
        color: color(ps.color),
        align: ps.textAlign === 'center' || ps.display.includes('flex') ? 'center' : alignment(ps),
        direction: ps.direction === 'rtl' ? 'rtl' : 'ltr',
        sizing: 'block',
        ...textCase(ps),
      };
      if (!paints) {
        node.kind = 'text';
        node.text = spec;
        node.style = { opacity: style.opacity, zIndex: style.zIndex };
      } else
        node.children = [
          {
            id: nodeId + '/text',
            name: 'Decoration text',
            kind: 'text',
            source: { tag: '#text' },
            bounds: { ...bounds },
            style: { opacity: 1 },
            position: 'absolute',
            children: [],
            text: spec,
          },
        ];
    }
    return node;
  };
  // What the author asked for, beyond what was measured: an item that takes its
  // row's free space, or one stretched to its container's cross size. The picture is
  // the same at the captured width; the difference shows when the design is resized.
  const authoredIntent = (el: Element, c: CSSStyleDeclaration, r: DOMRect) => {
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : undefined;
    if (!parent || c.position === 'absolute' || c.position === 'fixed') return {};
    const row = /flex/.test(parent.display) && parent.flexDirection.startsWith('row');
    const grow = row && parseFloat(c.flexGrow) > 0;
    const html = el as HTMLElement;
    const stretches =
      row &&
      el.parentElement!.childElementCount > 1 &&
      !!html.style &&
      (c.alignSelf === 'auto' || c.alignSelf === 'normal'
        ? parent.alignItems === 'normal' || parent.alignItems === 'stretch'
        : c.alignSelf === 'stretch');
    // Whether the height is authored cannot be read from computed styles, so ask the
    // layout: without the stretch, an item with no height of its own becomes shorter.
    let stretch = false;
    if (stretches) {
      const had = el.hasAttribute('style'),
        before = html.style.alignSelf;
      html.style.alignSelf = 'flex-start';
      stretch = el.getBoundingClientRect().height < r.height - 1;
      html.style.alignSelf = before;
      if (!had) el.removeAttribute('style');
    }
    return { ...(grow ? { grow: true } : {}), ...(stretch ? { stretch: true } : {}) };
  };
  // Boxes whose width comes from their content in CSS (inline boxes, floats,
  // non-growing items of a flex row) become hugging frames in Figma.
  const shrinkWrapped = (el: Element, c: CSSStyleDeclaration, r: DOMRect, n: SceneNode) => {
    if (/^inline/.test(c.display) || c.float !== 'none') return true;
    // Absolute boxes exactly as wide as their content (plus padding) were shrink-wrapped.
    if ((c.position === 'absolute' || c.position === 'fixed') && n.children.length) {
      const left = Math.min(...n.children.map((child) => child.bounds.x));
      const right = Math.max(...n.children.map((child) => child.bounds.x + child.bounds.width));
      const box =
        right -
        left +
        px(c.paddingLeft) +
        px(c.paddingRight) +
        px(c.borderLeftWidth) +
        px(c.borderRightWidth);
      if (Math.abs(r.width - box) <= 1) return true;
    }
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : undefined;
    return (
      !!parent &&
      /flex/.test(parent.display) &&
      parent.flexDirection.startsWith('row') &&
      c.flexGrow === '0'
    );
  };
  // Boxes sized by their container (absolute insets, stretched flex/grid items,
  // min-height) are taller than their content; hugging would collapse them.
  const stretchedHeight = (el: Element, c: CSSStyleDeclaration, r: DOMRect, n: SceneNode) => {
    const flow = n.children.filter(
      (child) => child.position !== 'absolute' && child.source.tag !== '#background',
    );
    if (!flow.length) return false;
    const top = Math.min(...flow.map((child) => child.bounds.y));
    const bottom = Math.max(...flow.map((child) => child.bounds.y + child.bounds.height));
    const content =
      bottom -
      top +
      px(c.paddingTop) +
      px(c.paddingBottom) +
      px(c.borderTopWidth) +
      px(c.borderBottomWidth);
    // Content taller than its box overflows it (a logo in a shorter slide); hugging would grow the box.
    if (content - r.height > 1.5) return true;
    if (r.height - content <= 1.5) return false;
    const parent = el.parentElement ? getComputedStyle(el.parentElement).display : '';
    return (
      c.position === 'absolute' ||
      c.position === 'fixed' ||
      /flex|grid/.test(parent) ||
      px(c.minHeight) > 0
    );
  };
  const buildElement = (el: Element, path: string, depth: number): SceneNode | null => {
    const c = getComputedStyle(el),
      r = el.getBoundingClientRect();
    if (hidden(el, c) || !r.width || !r.height || r.top + scrollY >= 16000) return null;
    if (++count > NODE_BUDGET || depth > DEPTH_BUDGET) return raster(el, r, path);
    const key = el.getAttribute('data-figma-id') || el.id || path,
      id = path;
    const box = boxStyle(c, r.width, r.height, id);
    const clipText = /text/.test(
      c.backgroundClip + ' ' + c.getPropertyValue('-webkit-background-clip'),
    );
    const backgroundUrl = clipText ? undefined : box.url;
    if (clipText && box.url)
      issue(id, 'unsupported-effect', 'Image-clipped text keeps its solid text colour.');
    const elementGradients = backgroundUrl ? box.below : box.above;
    const overlayGradients = backgroundUrl ? box.above : [];
    const textGradients = clipText ? [...box.above, ...box.below] : [];
    const n: SceneNode = {
      id,
      name: (
        el.getAttribute('aria-label') ||
        el.getAttribute('data-figma-id') ||
        el.id ||
        (
          {
            HEADER: 'Header',
            NAV: 'Navigation',
            MAIN: 'Main',
            SECTION: 'Section',
            ARTICLE: 'Card',
            FOOTER: 'Footer',
            H1: 'Heading',
            H2: 'Heading',
            H3: 'Heading',
            P: 'Description',
            BUTTON: 'Button',
          } as Record<string, string>
        )[el.tagName] ||
        el.classList[0] ||
        el.tagName.toLowerCase()
      )
        .replace(/\s+/g, ' ')
        .slice(0, 100),
      kind: 'frame',
      source: {
        tag: el.tagName.toLowerCase(),
        key,
        ...(el.getAttribute('role') ? { role: el.getAttribute('role')!.split(' ')[0]! } : {}),
      },
      bounds: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
      style: {
        ...box.style,
        ...(c.zIndex !== 'auto'
          ? { zIndex: parseInt(c.zIndex, 10) }
          : c.position !== 'static'
            ? { zIndex: 0 }
            : {}),
        ...(elementGradients.length && !clipText ? { gradients: elementGradients } : {}),
        clipContent: c.overflowX !== 'visible' || c.overflowY !== 'visible',
      },
      children: [],
      position: c.position === 'absolute' || c.position === 'fixed' ? 'absolute' : 'flow',
    };
    if (c.transform !== 'none' && !rotationOf(c.transform))
      issue(
        id,
        'transform',
        'Skewed or 3D transform is retained as measured bounds; editable geometry is approximated.',
      );
    // Generated content: positioned boxes become layers, inline strings join the text.
    const pseudoNodes: { before: SceneNode[]; after: SceneNode[] } = { before: [], after: [] };
    const inlinePseudo: Partial<
      Record<'before' | 'after', { text: string; style: CSSStyleDeclaration }>
    > = {};
    for (const which of ['before', 'after'] as const) {
      const ps = getComputedStyle(el, '::' + which);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      if (ps.visibility === 'hidden' || Number(ps.opacity) === 0) continue;
      const text = contentString(ps.content);
      const positioned = ps.position === 'absolute' || ps.position === 'fixed';
      if (!positioned && ps.display.startsWith('inline')) {
        // Inline strings (labels, quotes, icon-font glyphs) join the element's text.
        if (text !== null) {
          if (text) inlinePseudo[which] = { text, style: ps };
          continue;
        }
        issue(
          id,
          'pseudo-content',
          'Generated pseudo content is visible in screenshot but not editable.',
        );
        continue;
      }
      const decoration = pseudoBox(el, c, r, ps, which, id, text);
      if (decoration === 'empty') continue;
      if (decoration) pseudoNodes[which].push(decoration);
      else
        issue(
          id,
          'pseudo-content',
          'Generated pseudo content is visible in screenshot but not editable.',
        );
    }
    if (el instanceof HTMLVideoElement) {
      n.kind = 'image';
      n.image = { fit: 'fill', position: [0.5, 0.5] };
      sources.push({
        nodeId: id,
        kind: 'image',
        url: 'frame:video',
        width: r.width,
        height: r.height,
        mediaFrame: true,
      });
      flattened.add(id);
      issue(
        id,
        'media-static-frame',
        'Video retained as an editable image of its visible paused frame; playback is not imported.',
      );
      return n;
    }
    // Embedded players, maps and canvas charts cannot be rebuilt as layers; like video,
    // they are kept as an image of what they show, so the design has no hole there.
    if (['CANVAS', 'IFRAME'].includes(el.tagName)) {
      if (r.width >= 40 && r.height >= 40) {
        n.kind = 'image';
        n.name = el.tagName === 'CANVAS' ? 'Canvas' : 'Embed';
        n.image = { fit: 'fill', position: [0.5, 0.5] };
        sources.push({
          nodeId: id,
          kind: 'image',
          url: 'frame:' + el.tagName.toLowerCase(),
          width: r.width,
          height: r.height,
          mediaFrame: true,
        });
        flattened.add(id);
        issue(
          id,
          'media-static-frame',
          'Embedded content retained as an image of what it showed; it is not interactive.',
        );
        return n;
      }
      issue(id, 'unsupported-media', 'Dynamic media is present only in the source screenshot.');
    }
    const glyph = iconGlyph(el, c, r);
    if (glyph) {
      n.kind = 'image';
      n.name = 'Icon';
      n.children = [];
      sources.push({
        nodeId: id,
        kind: 'image',
        url: glyph,
        width: Math.round(r.width * 4),
        height: Math.round(r.height * 4),
      });
      n.image = { fit: 'fill', position: [0.5, 0.5] };
      flattened.add(id);
      return n;
    }
    if (el instanceof HTMLImageElement) {
      n.kind = 'image';
      sources.push({
        nodeId: id,
        kind: 'image',
        url: el.currentSrc || el.src,
        width: el.naturalWidth,
        height: el.naturalHeight,
        objectPosition: c.objectPosition,
      });
      n.image = {
        fit: ['cover', 'contain', 'none', 'scale-down'].includes(c.objectFit)
          ? (c.objectFit as 'cover' | 'contain' | 'none' | 'scale-down')
          : 'fill',
        position: [0.5, 0.5],
        contentBox: {
          x: px(c.borderLeftWidth) + px(c.paddingLeft),
          y: px(c.borderTopWidth) + px(c.paddingTop),
          width: Math.max(
            0,
            r.width -
              px(c.borderLeftWidth) -
              px(c.borderRightWidth) -
              px(c.paddingLeft) -
              px(c.paddingRight),
          ),
          height: Math.max(
            0,
            r.height -
              px(c.borderTopWidth) -
              px(c.borderBottomWidth) -
              px(c.paddingTop) -
              px(c.paddingBottom),
          ),
        },
        ...(el.naturalWidth && el.naturalHeight
          ? { intrinsicSize: { width: el.naturalWidth, height: el.naturalHeight } }
          : {}),
      };
      return n;
    }
    if (el instanceof SVGSVGElement) {
      const clone = el.cloneNode(true) as Element;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const originals = [el, ...el.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      const svgProperties = [
        'color',
        'fill',
        'fill-opacity',
        'fill-rule',
        'stroke',
        'stroke-opacity',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-miterlimit',
        'stroke-dasharray',
        'stroke-dashoffset',
        'opacity',
        'display',
        'visibility',
        'stop-color',
        'stop-opacity',
        'clip-rule',
        'clip-path',
        'mask',
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'text-anchor',
        'dominant-baseline',
      ];
      originals.forEach((original, index) => {
        const copy = copies[index] as SVGElement;
        const computed = getComputedStyle(original);
        copy.removeAttribute('style');
        for (const property of svgProperties) {
          let value = computed.getPropertyValue(property);
          // Computed SVG fragment paints may become absolute document URLs.
          value = value.replace(/url\(["']?([^"')]+)["']?\)/g, (match, target: string) => {
            const url = new URL(target, document.baseURI);
            return url.hash && url.href.split('#')[0] === location.href.split('#')[0]
              ? `url(${url.hash})`
              : match;
          });
          if (index === 0 && property === 'opacity') value = '1';
          if (!value || /url\((?!["']?#)/i.test(value)) continue;
          // Presentation attributes import more reliably than long inline style
          // declarations; computed values already resolve currentColor and classes.
          if (property === 'color') continue;
          if (
            /^(font-|text-anchor|dominant-baseline)/.test(property) &&
            !/^(text|tspan|textPath)$/i.test(original.tagName)
          )
            continue;
          if (property === 'display') {
            if (value === 'none') copy.setAttribute('display', 'none');
            continue;
          }
          if (property === 'visibility') {
            if (value !== 'visible') copy.setAttribute('visibility', value);
            continue;
          }
          if (/^(stroke-width|stroke-dashoffset|stroke-miterlimit|font-size)$/.test(property))
            value = value.replace(/px$/, '');
          if (property === 'stroke-dasharray') value = value.replace(/px/g, '');
          copy.setAttribute(property, value);
        }
      });
      // Sprite icons: <use href="#id"> points at a symbol elsewhere in the page, which an
      // exported SVG cannot reach. The referenced shapes are copied into the icon.
      const uses = [...el.querySelectorAll('use')];
      [...clone.querySelectorAll('use')].forEach((use, index) => {
        const original = uses[index];
        const ref = (use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').trim();
        const target = ref.startsWith('#') ? document.getElementById(ref.slice(1)) : null;
        if (!original || !target || target.contains(el) || el.contains(target)) return;
        const NS = 'http://www.w3.org/2000/svg';
        let symbol = /^symbol$/i.test(target.tagName);
        // The usual icon: an unsized <use> in an <svg> without a viewBox. The symbol's
        // viewBox moves to the icon itself, which every SVG importer understands
        // (nested <svg> viewports are less widely supported).
        const direct =
          symbol &&
          !clone.getAttribute('viewBox') &&
          !!target.getAttribute('viewBox') &&
          !['x', 'y', 'width', 'height'].some((name) => use.getAttribute(name));
        if (direct) {
          clone.setAttribute('viewBox', target.getAttribute('viewBox')!);
          const ratio = target.getAttribute('preserveAspectRatio');
          if (ratio) clone.setAttribute('preserveAspectRatio', ratio);
        }
        const holder = document.createElementNS(NS, symbol && !direct ? 'svg' : 'g');
        if (direct) {
          for (const child of target.childNodes) holder.appendChild(child.cloneNode(true));
          symbol = false;
        }
        const paint = getComputedStyle(original);
        if (symbol) {
          for (const name of ['viewBox', 'preserveAspectRatio']) {
            const value = target.getAttribute(name);
            if (value) holder.setAttribute(name, value);
          }
          for (const name of ['x', 'y', 'width', 'height']) {
            const value = use.getAttribute(name);
            if (value) holder.setAttribute(name, value);
          }
          for (const child of target.childNodes) holder.appendChild(child.cloneNode(true));
        } else {
          const x = parseFloat(use.getAttribute('x') ?? '0') || 0,
            y = parseFloat(use.getAttribute('y') ?? '0') || 0;
          if (x || y) holder.setAttribute('transform', `translate(${x} ${y})`);
          if (!direct) holder.appendChild(target.cloneNode(true));
        }
        // Shapes inherit paint from the <use>; currentColor resolves to its colour.
        for (const name of [
          'fill',
          'stroke',
          'stroke-width',
          'opacity',
          'fill-rule',
          'clip-rule',
        ]) {
          const value = paint.getPropertyValue(name);
          if (value && !/url\(/.test(value)) holder.setAttribute(name, value.replace(/px$/, ''));
        }
        for (const shape of [holder, ...holder.querySelectorAll('*')])
          for (const attribute of [...shape.attributes])
            if (/currentcolor/i.test(attribute.value))
              shape.setAttribute(attribute.name, paint.color);
        const transform = use.getAttribute('transform');
        if (transform && symbol) {
          const group = document.createElementNS(NS, 'g');
          group.setAttribute('transform', transform);
          group.appendChild(holder);
          use.replaceWith(group);
        } else use.replaceWith(holder);
      });
      clone
        .querySelectorAll('script,foreignObject,style,animate,set,animateTransform,use')
        .forEach((e) => e.remove());
      for (const e of [clone, ...clone.querySelectorAll('*')])
        for (const a of [...e.attributes])
          if (
            a.name.startsWith('on') ||
            (/href/i.test(a.name) && !a.value.startsWith('#')) ||
            /url\((?!["']?#)/i.test(a.value)
          )
            e.removeAttribute(a.name);
      n.kind = 'svg';
      sources.push({
        nodeId: id,
        kind: 'svg',
        url: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(clone.outerHTML))),
        width: r.width,
        height: r.height,
      });
      return n;
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      issue(
        id,
        'form-control-appearance',
        'Live control text retained; browser-native control appearance, state and internal clipping require review.',
      );
      const value =
        el instanceof HTMLSelectElement
          ? [...el.selectedOptions].map((option) => option.label).join('\n')
          : el instanceof HTMLInputElement
            ? el.type === 'password'
              ? '•'.repeat(el.value.length)
              : [
                    'text',
                    'search',
                    'url',
                    'email',
                    'tel',
                    'number',
                    'button',
                    'submit',
                    'reset',
                  ].includes(el.type)
                ? el.value || el.placeholder
                : ''
            : el.value || el.placeholder;
      if (value) {
        const child: SceneNode = {
          id: id + '/text',
          name: n.name + ' text',
          kind: 'text',
          source: { tag: '#text' },
          bounds: {
            x: n.bounds.x + px(c.borderLeftWidth) + px(c.paddingLeft),
            y: n.bounds.y + px(c.borderTopWidth) + px(c.paddingTop),
            width: Math.max(
              0.01,
              r.width -
                px(c.borderLeftWidth) -
                px(c.borderRightWidth) -
                px(c.paddingLeft) -
                px(c.paddingRight),
            ),
            height: Math.max(
              0.01,
              r.height -
                px(c.borderTopWidth) -
                px(c.borderBottomWidth) -
                px(c.paddingTop) -
                px(c.paddingBottom),
            ),
          },
          style: { opacity: 1 },
          children: [],
          position: 'absolute',
          text: {
            characters: transformedText(value, c),
            fontFamily: c.fontFamily,
            fontStyle: c.fontStyle,
            fontWeight: px(c.fontWeight) || 400,
            fontSize: px(c.fontSize),
            lineHeight: lineHeight(c, value),
            letterSpacing: px(c.letterSpacing),
            color: color(c.color),
            align: alignment(c),
            direction: c.direction === 'rtl' ? 'rtl' : 'ltr',
            sizing: 'block',
            ...(el instanceof HTMLInputElement || (el instanceof HTMLSelectElement && !el.multiple)
              ? { maxLines: 1 }
              : {}),
          },
        };
        n.children = [child];
        textSources.push({ nodeId: child.id, selector: cssPath(el) });
      }
      n.style.clipContent = true;
      return n;
    }
    const hasAsset = !!el.querySelector('svg,img,canvas,video,iframe');
    const hasBlock = [...el.children].some(
      (e) =>
        !['inline', 'inline-block', 'contents'].includes(getComputedStyle(e).display) &&
        e.tagName !== 'BR',
    );
    if (
      !hasBlock &&
      !hasAsset &&
      ((el.textContent ?? '').trim() ||
        inlinePseudo.before?.text.trim() ||
        inlinePseudo.after?.text.trim())
    ) {
      n.kind = 'text';
      let characters = '';
      const runs: NonNullable<NonNullable<SceneNode['text']>['runs']> = [];
      // Boxes drawn behind or under part of the copy: a highlighted phrase (an inline
      // background) and an underline made with a bottom border. One box per line the
      // phrase is on, placed where the browser painted it.
      const marks: SceneNode[] = [];
      const mark = (
        name: string,
        box: { x: number; y: number; width: number; height: number },
        fill: ReturnType<typeof color>,
        radius: number,
      ) => {
        if (box.width < 1 || box.height < 0.5 || marks.length >= 40) return;
        marks.push({
          id: `${id}/mark-${marks.length}`,
          name,
          kind: 'frame',
          source: { tag: 'span' },
          bounds: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height },
          style: {
            opacity: 1,
            background: fill,
            ...(radius ? { radius: [radius, radius, radius, radius] } : {}),
          },
          position: 'absolute',
          children: [],
        });
      };
      const add = (node: Node) => {
        if (node instanceof Element) {
          if (hidden(node)) return;
          const inline = getComputedStyle(node);
          const paint = color(inline.backgroundColor),
            underline = px(inline.borderBottomWidth),
            underlineColor = color(inline.borderBottomColor);
          const marked =
            node !== el &&
            inline.display === 'inline' &&
            (paint.a > 0 ||
              (underline > 0 && inline.borderBottomStyle !== 'none' && underlineColor.a > 0));
          if (marked)
            for (const rect of node.getClientRects()) {
              if (paint.a > 0)
                mark(
                  'Highlight',
                  rect,
                  paint,
                  Math.min(px(inline.borderTopLeftRadius), rect.height / 2),
                );
              if (underline > 0 && inline.borderBottomStyle !== 'none' && underlineColor.a > 0)
                mark(
                  'Underline',
                  { x: rect.x, y: rect.bottom - underline, width: rect.width, height: underline },
                  underlineColor,
                  0,
                );
            }
          if (
            node !== el &&
            !marked &&
            (paint.a > 0 ||
              inline.backgroundImage !== 'none' ||
              Number(inline.opacity) !== 1 ||
              px(inline.borderTopWidth) ||
              inline.transform !== 'none')
          )
            issue(
              id,
              'inline-style-unsupported',
              'Inline box decoration, opacity or transform is not preserved by a merged text run.',
            );
          if (node.tagName === 'BR') {
            characters += '\n';
            return;
          }
          if (node !== el) addPseudo('before', node);
          node.childNodes.forEach(add);
          if (node !== el) addPseudo('after', node);
          return;
        }
        if (node.nodeType !== Node.TEXT_NODE) return;
        const style = getComputedStyle(node.parentElement!);
        let s = node.textContent ?? '';
        if (!preservesSpaces(style)) s = s.replace(/\s+/g, ' ');
        if (
          !preservesSpaces(style) &&
          (!characters || characters.endsWith(' ') || characters.endsWith('\n'))
        )
          s = s.replace(/^ +/, '');
        s = transformedText(s, style);
        const start = characters.length;
        characters += s;
        if (s)
          runs.push({
            start,
            end: characters.length,
            fontFamily: style.fontFamily,
            fontStyle: style.fontStyle,
            fontWeight: px(style.fontWeight) || 400,
            fontSize: px(style.fontSize),
            color: color(style.color),
            textDecoration: decoration(node.parentElement!),
            letterSpacing: px(style.letterSpacing),
            lineHeight: lineHeight(style, s),
            ...(variations(style) ? { variationSettings: variations(style) } : {}),
            ...textCase(style),
          });
      };
      const addPseudo = (which: 'before' | 'after', owner?: Element) => {
        let pseudo = owner ? undefined : inlinePseudo[which];
        if (owner) {
          // Inline descendants (links, labels) contribute their generated strings too.
          const ps = getComputedStyle(owner, '::' + which);
          const value =
            ps.content === 'none' || ps.content === 'normal' ? null : contentString(ps.content);
          if (value && ps.display.startsWith('inline') && !/absolute|fixed/.test(ps.position))
            pseudo = { text: value, style: ps };
        }
        if (!pseudo) return;
        const style = pseudo.style;
        const start = characters.length;
        characters += pseudo.text;
        runs.push({
          start,
          end: characters.length,
          fontFamily: style.fontFamily,
          fontStyle: style.fontStyle,
          fontWeight: px(style.fontWeight) || 400,
          fontSize: px(style.fontSize),
          color: color(style.color),
          letterSpacing: px(style.letterSpacing),
          lineHeight: lineHeight(style, pseudo.text),
          ...textCase(style),
        });
      };
      addPseudo('before');
      el.childNodes.forEach(add);
      addPseudo('after');
      if (!preservesSpaces(c)) characters = characters.trimEnd();
      runs.forEach((t) => (t.end = Math.min(t.end, characters.length)));
      const textRange = document.createRange();
      textRange.selectNodeContents(el);
      const ink = textRange.getBoundingClientRect();
      const contentWidth =
        r.width -
        px(c.borderLeftWidth) -
        px(c.borderRightWidth) -
        px(c.paddingLeft) -
        px(c.paddingRight);
      const contentHeight =
        r.height -
        px(c.borderTopWidth) -
        px(c.borderBottomWidth) -
        px(c.paddingTop) -
        px(c.paddingBottom);
      const computedWidth = (
        el as Element & {
          computedStyleMap?: () => { get(name: string): { toString(): string } | undefined };
        }
      )
        .computedStyleMap?.()
        .get('width')
        ?.toString();
      const intrinsicText =
        !characters.includes('\n') &&
        contentHeight <= lineHeight(c, characters) + 1 &&
        ink.height <= lineHeight(c, characters) + 1 &&
        (c.display.startsWith('inline') ||
          (computedWidth === 'auto' && Math.abs(ink.width - contentWidth) <= 1));
      n.text = {
        characters,
        fontFamily: c.fontFamily,
        fontStyle: c.fontStyle,
        fontWeight: px(c.fontWeight) || 400,
        fontSize: px(c.fontSize),
        lineHeight: lineHeight(c, characters),
        textDecoration: decoration(el),
        ...(variations(c) ? { variationSettings: variations(c) } : {}),
        letterSpacing: px(c.letterSpacing),
        color: color(c.color),
        align: alignment(c),
        direction: c.direction === 'rtl' ? 'rtl' : 'ltr',
        sizing: intrinsicText ? 'inline' : 'block',
        lines: lineCount(textRange),
        ...lineBreaks(el, characters, lineCount(textRange)),
        ...(c.textOverflow === 'ellipsis' && c.whiteSpace === 'nowrap' ? { maxLines: 1 } : {}),
        ...textCase(c),
        ...textShadow(c),
        runs: runs.filter((t) => t.end > t.start),
      };
      const decorated =
        !!backgroundUrl ||
        (n.style.background?.a ?? 0) > 0 ||
        !!n.style.border ||
        !!n.style.shadow ||
        !!n.style.gradients?.length ||
        !!n.style.backdropBlur ||
        pseudoNodes.before.length + pseudoNodes.after.length > 0 ||
        marks.length > 0 ||
        [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].some((v) => px(v) > 0);
      if (decorated) {
        const child: SceneNode = {
          ...n,
          id: id + '/text',
          name: n.name + ' text',
          source: { tag: '#text' },
          // The label flows inside its box even when the box itself is positioned.
          position: 'flow',
          style: { opacity: 1, ...(textGradients.length ? { gradients: textGradients } : {}) },
          children: [],
          bounds: {
            x: n.bounds.x + px(c.borderLeftWidth) + px(c.paddingLeft),
            y: n.bounds.y + px(c.borderTopWidth) + px(c.paddingTop),
            width: Math.max(
              0,
              r.width -
                px(c.borderLeftWidth) -
                px(c.borderRightWidth) -
                px(c.paddingLeft) -
                px(c.paddingRight),
            ),
            height: Math.max(
              0,
              r.height -
                px(c.borderTopWidth) -
                px(c.borderBottomWidth) -
                px(c.paddingTop) -
                px(c.paddingBottom),
            ),
          },
        };
        delete n.text;
        n.kind = 'frame';
        // Marks come first: they sit behind the copy.
        n.children = [...marks, child];
        textSources.push({ nodeId: child.id, selector: cssPath(el) });
      } else {
        if (textGradients.length) n.style.gradients = textGradients;
        textSources.push({ nodeId: n.id, selector: cssPath(el) });
        return n;
      }
    }
    if (!n.children.length) n.children = childNodes(el, path, depth + 1);
    // Text nodes between block/asset children need their own measured editable nodes.
    if (hasBlock || hasAsset) {
      let index = 0;
      for (const node of el.childNodes) {
        const i = index++;
        const text = measuredText(el, node, id + '/direct-' + i);
        if (text) n.children.push(text);
      }
      n.children.sort((a, b) => {
        const order = (child: SceneNode) => {
          const segment = child.id.slice(id.length + 1).split('/')[0]!;
          return segment.startsWith('direct-')
            ? Number(segment.slice(7))
            : [...el.childNodes].indexOf(el.children[Number(segment)]!);
        };
        return order(a) - order(b);
      });
    }
    const flex = c.display.includes('flex'),
      grid = c.display.includes('grid'),
      horizontal = flex && c.flexDirection.startsWith('row');
    const crossAlign =
      c.alignItems === 'center'
        ? 'center'
        : c.alignItems.includes('end')
          ? 'end'
          : c.alignItems === 'stretch'
            ? 'stretch'
            : 'start';
    // In a right-to-left column the inline start is the right edge.
    const align =
      c.direction === 'rtl' && !horizontal && !grid
        ? crossAlign === 'start'
          ? 'end'
          : crossAlign === 'end'
            ? 'start'
            : crossAlign
        : crossAlign;
    let gap = px(horizontal || grid ? c.columnGap : c.rowGap);
    if (!flex && !grid && n.children.length > 1) {
      const gaps = n.children
        .slice(1)
        .map((x, i) => x.bounds.y - (n.children[i]!.bounds.y + n.children[i]!.bounds.height));
      if (gaps.every((g) => g >= 0) && Math.max(...gaps) - Math.min(...gaps) < 1) gap = gaps[0]!;
      else
        issue(
          id,
          'margin-spacing',
          'Block margin/collapse spacing retained in source coordinates; auto layout is approximate.',
        );
    }
    n.layout = {
      mode: grid ? 'grid' : horizontal ? 'horizontal' : 'vertical',
      gap,
      rowGap: px(c.rowGap),
      padding: [px(c.paddingTop), px(c.paddingRight), px(c.paddingBottom), px(c.paddingLeft)],
      align,
      justify:
        c.justifyContent === 'space-between'
          ? 'space-between'
          : c.justifyContent === 'center'
            ? 'center'
            : c.justifyContent.includes('end')
              ? 'end'
              : 'start',
      wrap: c.flexWrap === 'wrap',
      widthSizing:
        el.parentElement &&
        Math.abs(
          r.width -
            (el.parentElement.getBoundingClientRect().width -
              px(getComputedStyle(el.parentElement).paddingLeft) -
              px(getComputedStyle(el.parentElement).paddingRight) -
              px(getComputedStyle(el.parentElement).borderLeftWidth) -
              px(getComputedStyle(el.parentElement).borderRightWidth)),
        ) < 1
          ? 'fill'
          : shrinkWrapped(el, c, r, n)
            ? 'hug'
            : 'fixed',
      heightSizing:
        !(el as HTMLElement).style.height &&
        c.display !== 'inline' &&
        n.children.length > 0 &&
        !stretchedHeight(el, c, r, n)
          ? 'hug'
          : 'fixed',
      ...authoredIntent(el, c, r),
      ...(grid ? { columns: c.gridTemplateColumns.split(' ').filter(Boolean).length } : {}),
      ...(grid && /^(?:[\d.]+px\s*)+$/.test(c.gridTemplateColumns)
        ? { tracks: c.gridTemplateColumns.split(' ').filter(Boolean).map(px) }
        : {}),
      ...(c.minWidth.endsWith('px') ? { minWidth: px(c.minWidth) } : {}),
      ...(c.maxWidth.endsWith('px') ? { maxWidth: px(c.maxWidth) } : {}),
    };
    const widthExtras =
      c.boxSizing === 'border-box'
        ? 0
        : px(c.paddingLeft) + px(c.paddingRight) + px(c.borderLeftWidth) + px(c.borderRightWidth);
    if (n.layout.minWidth !== undefined) n.layout.minWidth += widthExtras;
    if (n.layout.maxWidth !== undefined) {
      n.layout.maxWidth += widthExtras;
      // CSS gives min-width precedence when its bounds conflict with max-width.
      n.layout.maxWidth = Math.max(n.layout.maxWidth, n.layout.minWidth ?? 0);
    }
    const unsupportedGrid =
      grid &&
      (c.gridAutoFlow !== 'row' ||
        Math.abs(
          n.children
            .filter((child) => child.position !== 'absolute')
            .reduce(
              (right, child) => Math.max(right, child.bounds.x + child.bounds.width),
              n.bounds.x,
            ) -
            (n.bounds.x + n.bounds.width - px(c.paddingRight) - px(c.borderRightWidth)),
        ) > 1 ||
        /\[|subgrid|masonry/.test(c.gridTemplateColumns) ||
        [...el.children].some((child) => {
          const style = getComputedStyle(child);
          // Empty or hidden items (sentinels, spacers) are not imported and cannot move others.
          const box = child.getBoundingClientRect();
          if (hidden(child, style) || !box.width || !box.height) return false;
          return [
            style.gridColumnStart,
            style.gridColumnEnd,
            style.gridRowStart,
            style.gridRowEnd,
          ].some((value) => value !== 'auto');
        }));
    const reversed =
      flex &&
      (c.flexDirection.endsWith('reverse') ||
        c.flexWrap === 'wrap-reverse' ||
        [...el.children].some((child) => getComputedStyle(child).order !== '0'));
    if (unsupportedGrid || reversed) {
      n.layout.mode = 'none';
      issue(
        id,
        'layout-fixed-unsupported',
        'Grid placement, spans, dense flow, reversed flow or reordered children retained as measured fixed positions.',
      );
    } else if (grid)
      issue(
        id,
        'grid-tracks-inferred',
        'Grid track proportions are inferred from this viewport; fixed versus flexible track behavior requires resize review.',
      );
    if (pseudoNodes.before.length || pseudoNodes.after.length)
      n.children = [...pseudoNodes.before, ...n.children, ...pseudoNodes.after];
    // Right-to-left rows and grids flow from the right edge. Figma auto layout always
    // flows left to right, so in-flow children are stored in visual order instead.
    if (c.direction === 'rtl' && (n.layout.mode === 'horizontal' || n.layout.mode === 'grid')) {
      const inFlow = (child: SceneNode) =>
        child.position !== 'absolute' && child.source.tag !== '#background';
      const visual = n.children
        .filter(inFlow)
        .sort((a, b) =>
          n.layout!.mode === 'grid' || n.layout!.wrap
            ? Math.round(a.bounds.y) - Math.round(b.bounds.y) || a.bounds.x - b.bounds.x
            : a.bounds.x - b.bounds.x,
        );
      let next = 0;
      n.children = n.children.map((child) => (inFlow(child) ? visual[next++]! : child));
      if (n.layout.mode === 'horizontal')
        n.layout.justify =
          n.layout.justify === 'start'
            ? 'end'
            : n.layout.justify === 'end'
              ? 'start'
              : n.layout.justify;
    }
    if (backgroundUrl) {
      const inset =
        c.backgroundOrigin === 'border-box'
          ? [0, 0, 0, 0]
          : [
              px(c.borderTopWidth),
              px(c.borderRightWidth),
              px(c.borderBottomWidth),
              px(c.borderLeftWidth),
            ];
      if (c.backgroundOrigin === 'content-box') {
        inset[0]! += px(c.paddingTop);
        inset[1]! += px(c.paddingRight);
        inset[2]! += px(c.paddingBottom);
        inset[3]! += px(c.paddingLeft);
      }
      const background: SceneNode = {
        id: id + '/background',
        name: 'Background / ' + n.name,
        kind: 'image',
        source: { tag: '#background', key: key + '/background' },
        bounds: { ...n.bounds },
        style: {
          opacity: 1,
          ...(n.style.radius
            ? { radius: [...n.style.radius] as [number, number, number, number] }
            : {}),
          ...(overlayGradients.length ? { gradients: overlayGradients } : {}),
        },
        position: 'absolute',
        children: [],
        image: {
          fit: 'none',
          position: [0, 0],
          contentBox: {
            x: inset[3]!,
            y: inset[0]!,
            width: Math.max(0, r.width - inset[1]! - inset[3]!),
            height: Math.max(0, r.height - inset[0]! - inset[2]!),
          },
        },
      };
      n.children.unshift(background);
      sources.push({
        nodeId: background.id,
        kind: 'image',
        url: backgroundUrl,
        width: 0,
        height: 0,
        objectPosition: splitTop(c.backgroundPosition, ',')[box.urlIndex] ?? c.backgroundPosition,
        background: {
          size: splitTop(c.backgroundSize, ',')[box.urlIndex] ?? c.backgroundSize,
          repeat: splitTop(c.backgroundRepeat, ',')[box.urlIndex] ?? c.backgroundRepeat,
        },
      });
    }
    return n;
  };
  /** Leaf layers rotate natively; rotated containers keep measured child positions. */
  const build = (el: Element, path: string, depth: number): SceneNode | null => {
    const node = buildElement(el, path, depth);
    if (!node || flattened.has(node.id)) return node;
    const transform = getComputedStyle(el).transform;
    const t = transform === 'none' ? null : rotationOf(transform);
    if (!t || Math.abs(t.rotation) < 0.5) return node;
    const leaf = node.kind !== 'frame' || node.children.length === 0;
    const element = el as HTMLElement;
    const width = element.offsetWidth ?? el.clientWidth,
      height = element.offsetHeight ?? el.clientHeight;
    if (!leaf || !width || !height) {
      issue(
        node.id,
        'transform',
        'Rotated container keeps measured child positions; its rotation is approximated.',
      );
      return node;
    }
    node.style.rotation = t.rotation;
    node.style.size = { width: width * t.sx, height: height * Math.abs(t.sy) };
    return node;
  };
  // Colours the page names itself: custom properties declared in its style sheets,
  // with the value they have on the root element.
  const colorTokens = () => {
    const names: string[] = [],
      seen = new Set<string>();
    const scan = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const style = (rule as CSSStyleRule).style;
        if (style)
          for (let i = 0; i < style.length; i++) {
            const name = style[i]!;
            if (name.startsWith('--') && !seen.has(name) && seen.size < 2000) {
              seen.add(name);
              names.push(name);
            }
          }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) scan(nested);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        scan(sheet.cssRules);
      } catch {
        // A style sheet from another origin cannot be read.
      }
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const parse = (value: string) => {
      // An invalid value leaves the canvas colour untouched; two different starting
      // colours tell a real colour from a value that is not one.
      const read = (start: string) => {
        colorContext.fillStyle = start;
        colorContext.fillStyle = value;
        return String(colorContext.fillStyle);
      };
      return read('#010203') === read('#030201') ? color(value) : undefined;
    };
    const tokens: { name: string; value: { r: number; g: number; b: number; a: number } }[] = [],
      used = new Set<string>();
    for (const raw of names) {
      if (/^--(tw|un|chakra-ring|swiper|fa|bs-gutter)-/.test(raw)) continue;
      const value = rootStyle.getPropertyValue(raw).trim();
      if (
        !value ||
        value.length > 80 ||
        /^(inherit|initial|unset|transparent|currentcolor|none)$/i.test(value)
      )
        continue;
      // "220 90% 50%" is a colour written for hsl(var(--name)).
      const parsed =
        parse(value) ??
        (/^-?[\d.]+(deg)?[ ,]+[\d.]+%[ ,]+[\d.]+%$/.test(value)
          ? parse('hsl(' + value + ')')
          : undefined);
      if (!parsed || parsed.a === 0) continue;
      const name = raw
        .replace(/^--/, '')
        .split('--')
        .filter((part) => !/^(wp|preset|color|colors|colour|global|e|theme)$/.test(part))
        .join('-')
        .replace(/^(color|colors|colour|clr)-/, '')
        .replace(/-(color|colour)$/, '')
        .slice(0, 80);
      if (!name || used.has(name)) continue;
      used.add(name);
      tokens.push({ name, value: parsed });
      if (tokens.length >= 300) break;
    }
    return tokens;
  };
  const el = selector ? document.querySelector(selector) : document.body;
  if (!el) throw new Error('Capture selector was not found');
  const root = build(el, 'root', 0);
  if (!root) throw new Error('Capture selector is not visible');
  if (omitted)
    issues.push({
      code: 'content-omitted',
      severity: 'warning',
      message: `${omitted} deeply nested or over-budget region(s) were left out of the editable layers.`,
    });
  return { root, issues, sources, textSources, tokens: colorTokens() };
}
