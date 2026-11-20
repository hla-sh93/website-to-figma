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
  const transformedText = (value: string, c: CSSStyleDeclaration) => {
    if (c.textTransform === 'uppercase') return value.toUpperCase();
    if (c.textTransform === 'lowercase') return value.toLowerCase();
    if (c.textTransform === 'capitalize') return value.replace(/\b\p{L}/gu, (x) => x.toUpperCase());
    return value;
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
      },
    };
  };
  const childNodes = (
    el: Element,
    path: string,
    depth: number,
    includeDirect = false,
  ): SceneNode[] => {
    if (depth > 65) throw new Error('Capture DOM node/depth budget exceeded');
    return [...el.childNodes].flatMap((child, index): SceneNode[] => {
      if (!(child instanceof Element)) {
        const text = includeDirect ? measuredText(el, child, path + '/direct-' + index) : null;
        if (text && ++count > 2200) throw new Error('Capture DOM node/depth budget exceeded');
        return text ? [text] : [];
      }
      const c = getComputedStyle(child),
        r = child.getBoundingClientRect();
      if (hidden(child, c)) return [];
      const childPath = path + '/' + [...el.children].indexOf(child);
      if (!r.width || !r.height || c.display === 'contents') {
        if (++count > 2200) throw new Error('Capture DOM node/depth budget exceeded');
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
  const build = (el: Element, path: string, depth: number): SceneNode | null => {
    const c = getComputedStyle(el),
      r = el.getBoundingClientRect();
    if (hidden(el, c) || !r.width || !r.height || r.top + scrollY >= 16000) return null;
    if (++count > 2200 || depth > 65) throw new Error('Capture DOM node/depth budget exceeded');
    const key = el.getAttribute('data-figma-id') || el.id || path,
      id = path;
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
      source: { tag: el.tagName.toLowerCase(), key },
      bounds: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
      style: {
        opacity: px(c.opacity),
        ...(c.zIndex !== 'auto'
          ? { zIndex: parseInt(c.zIndex, 10) }
          : c.position !== 'static'
            ? { zIndex: 0 }
            : {}),
        background: color(c.backgroundColor),
        radius: [
          px(c.borderTopLeftRadius),
          px(c.borderTopRightRadius),
          px(c.borderBottomRightRadius),
          px(c.borderBottomLeftRadius),
        ],
        clipContent: c.overflowX !== 'visible' || c.overflowY !== 'visible',
      },
      children: [],
      position: c.position === 'absolute' || c.position === 'fixed' ? 'absolute' : 'flow',
    };
    if (px(c.borderTopWidth))
      n.style.border = { width: px(c.borderTopWidth), color: color(c.borderTopColor) };
    if (c.transform !== 'none')
      issue(
        id,
        'transform',
        'Transform is retained as measured bounds; editable transform and rotated child geometry are approximated.',
      );
    if (c.boxShadow !== 'none') {
      const m = c.boxShadow.match(
        /^(rgba?\([^)]+\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px (-?[\d.]+)px$/,
      );
      if (m)
        n.style.shadow = [
          { color: color(m[1]!), x: px(m[2]!), y: px(m[3]!), blur: px(m[4]!), spread: px(m[5]!) },
        ];
      else
        issue(
          id,
          'unsupported-effect',
          'Complex or inset shadow is not represented by editable style.',
        );
    }
    const backgroundMatch = c.backgroundImage.match(/^url\("((?:\\.|[^"\\])*)"\)$/s);
    const backgroundUrl = backgroundMatch?.[1]?.replace(
      /\\([0-9a-f]{1,6})\s?|\\(.)/gi,
      (_match, hex: string | undefined, escaped: string) =>
        hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16))) : escaped,
    );
    if ((c.backgroundImage !== 'none' && !backgroundUrl) || c.filter !== 'none')
      issue(
        id,
        'unsupported-effect',
        'Background image/gradient, shadow, or filter is not represented by editable style.',
      );
    for (const pseudo of ['::before', '::after']) {
      const s = getComputedStyle(el, pseudo);
      if (s.content !== 'none' && s.content !== 'normal')
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
      issue(
        id,
        'media-static-frame',
        'Video retained as an editable image of its visible paused frame; playback is not imported.',
      );
      return n;
    }
    if (['CANVAS', 'IFRAME'].includes(el.tagName))
      issue(id, 'unsupported-media', 'Dynamic media is present only in the source screenshot.');
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
          if (value && !/url\((?!["']?#)/i.test(value)) copy.style.setProperty(property, value);
        }
      });
      clone
        .querySelectorAll('script,foreignObject,style,animate,set,animateTransform')
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
    if (!hasBlock && !hasAsset && (el.textContent ?? '').trim()) {
      n.kind = 'text';
      let characters = '';
      const runs: NonNullable<NonNullable<SceneNode['text']>['runs']> = [];
      const add = (node: Node) => {
        if (node instanceof Element) {
          if (hidden(node)) return;
          const inline = getComputedStyle(node);
          if (
            node !== el &&
            (color(inline.backgroundColor).a > 0 ||
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
          node.childNodes.forEach(add);
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
          });
      };
      el.childNodes.forEach(add);
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
        ...(c.textOverflow === 'ellipsis' && c.whiteSpace === 'nowrap' ? { maxLines: 1 } : {}),
        runs: runs.filter((t) => t.end > t.start),
      };
      const decorated =
        !!backgroundUrl ||
        (n.style.background?.a ?? 0) > 0 ||
        !!n.style.border ||
        !!n.style.shadow ||
        [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].some((v) => px(v) > 0);
      if (decorated) {
        const child: SceneNode = {
          ...n,
          id: id + '/text',
          name: n.name + ' text',
          source: { tag: '#text' },
          style: { opacity: 1 },
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
        n.children = [child];
        textSources.push({ nodeId: child.id, selector: cssPath(el) });
      } else {
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
    const align =
      c.alignItems === 'center'
        ? 'center'
        : c.alignItems.includes('end')
          ? 'end'
          : c.alignItems === 'stretch'
            ? 'stretch'
            : 'start';
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
          : 'fixed',
      heightSizing:
        !(el as HTMLElement).style.height && c.display !== 'inline' && n.children.length > 0
          ? 'hug'
          : 'fixed',
      ...(grid ? { columns: c.gridTemplateColumns.split(' ').filter(Boolean).length } : {}),
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
        objectPosition: c.backgroundPosition,
        background: { size: c.backgroundSize, repeat: c.backgroundRepeat },
      });
    }
    return n;
  };
  const el = selector ? document.querySelector(selector) : document.body;
  if (!el) throw new Error('Capture selector was not found');
  const root = build(el, 'root', 0);
  if (!root) throw new Error('Capture selector is not visible');
  return { root, issues, sources, textSources };
}
