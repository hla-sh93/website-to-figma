import type { SceneNode } from './scene.js';

/** Utility-class and generated names say nothing about what a layer is. */
const UTILITY =
  /^(?:[\w-]+:)*!?-?(?:(?:m|p)[trblxyse]?|w|h|size|min-w|min-h|max-w|max-h|gap|gap-x|gap-y|space-x|space-y|top|left|right|bottom|start|end|inset|inset-x|inset-y|z|order|col|cols|row|rows|basis|grow|shrink|flex|grid|grid-cols|grid-rows|auto-cols|auto-rows|text|font|leading|tracking|bg|border|rounded|shadow|ring|outline|opacity|items|justify|content|self|place|overflow|object|aspect|translate|translate-x|translate-y|rotate|scale|skew|origin|transition|duration|ease|delay|animate|cursor|select|pointer-events|fill|stroke|decoration|underline|line-clamp|whitespace|break|list|columns|divide|backdrop|blur|brightness|from|via|to|scroll|snap|touch|will-change|indent|align|float|clear|box|sr|not-sr|drop-shadow|mix-blend|accent|caret|appearance|resize|table|isolation)(?:-|$)/;
const KEYWORD =
  /^(?:[\w-]+:)*(?:block|inline|inline-block|inline-flex|inline-grid|flex|grid|hidden|contents|relative|absolute|fixed|sticky|static|container|group|peer|sr-only|truncate|italic|uppercase|lowercase|capitalize|underline|antialiased|isolate|visible|invisible|grow|shrink|lucide|icon|svg|wrapper|inner|outer|content|container-fluid|row|col|clearfix|d-flex)$/i;
const GENERIC_TAGS = new Set([
  'div',
  'span',
  'svg',
  'g',
  'path',
  'i',
  'b',
  'em',
  'strong',
  'small',
  'body',
  'html',
  'document',
  'picture',
  'source',
  'text',
  '#text',
]);

const TAGS: Record<string, string> = {
  body: 'Page',
  header: 'Header',
  nav: 'Navigation',
  main: 'Main',
  footer: 'Footer',
  section: 'Section',
  article: 'Card',
  aside: 'Sidebar',
  form: 'Form',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  a: 'Link',
  button: 'Button',
  input: 'Input',
  textarea: 'Text area',
  select: 'Select',
  label: 'Label',
  img: 'Image',
  video: 'Video',
  canvas: 'Canvas',
  iframe: 'Embed',
  figure: 'Figure',
  figcaption: 'Caption',
  table: 'Table',
  dialog: 'Dialog',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  p: 'Paragraph',
  blockquote: 'Quote',
};
const ROLES: Record<string, string> = {
  banner: 'Header',
  navigation: 'Navigation',
  main: 'Main',
  contentinfo: 'Footer',
  button: 'Button',
  link: 'Link',
  img: 'Image',
  list: 'List',
  listitem: 'List item',
  dialog: 'Dialog',
  search: 'Search',
  tablist: 'Tabs',
  tab: 'Tab',
  menu: 'Menu',
  menuitem: 'Menu item',
  region: 'Section',
  form: 'Form',
  progressbar: 'Progress',
  slider: 'Slider',
};
/** Old automatic names produced by the collector for tags; treated as generic. */
const AUTOMATIC = new Set([
  'Header',
  'Navigation',
  'Main',
  'Section',
  'Card',
  'Footer',
  'Heading',
  'Description',
  'Button',
  'text',
]);

const short = (value: string, max = 40) => {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
};
const humanize = (value: string) => {
  const modules = /^([A-Za-z][A-Za-z0-9]*)_([A-Za-z][A-Za-z0-9]*)__[\w-]{4,}$/.exec(value);
  const words = (modules ? `${modules[1]} ${modules[2]}` : value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** True when a captured name came from markup authors (aria-label, id, a descriptive class). */
export function isMeaningfulName(name: string, tag = ''): boolean {
  const value = name.trim();
  if (!value || AUTOMATIC.has(value) || value === tag || GENERIC_TAGS.has(value.toLowerCase()))
    return false;
  // Labels written for people (aria-label, data-figma-id) contain spaces or non-Latin text.
  if (/\s/.test(value) || /[^\x00-\x7f]/.test(value)) return true;
  if (/[:[\]/!@#%]/.test(value) || value.startsWith('__') || value.startsWith('--')) return false;
  if (/^(?:css|sc|jsx|svelte|emotion|tw|chakra|mui|Mui\w*|ant)-[\w-]*\d/.test(value)) return false;
  if (/\d{3,}|[a-z]\d[a-z\d]*\d/i.test(value.replace(/_[\w-]{4,}$/, '')) && !/^h[1-6]$/.test(value))
    return false;
  if (UTILITY.test(value) || KEYWORD.test(value)) return false;
  return /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(value);
}

const textOf = (node: SceneNode, max = 3): string => {
  const parts: string[] = [];
  const walk = (n: SceneNode) => {
    if (parts.length >= max) return;
    if (n.text?.characters.trim()) parts.push(n.text.characters);
    n.children.forEach(walk);
  };
  walk(node);
  return parts.join(' ');
};
const count = (node: SceneNode, test: (n: SceneNode) => boolean): number =>
  node.children.reduce((sum, c) => sum + (test(c) ? 1 : 0) + count(c, test), 0);
const shape = (n: SceneNode): string =>
  `${n.kind}:${n.source.tag}(${n.children.map(shape).join(',')})`;

function layoutName(node: SceneNode): string {
  const layout = node.layout;
  if (layout?.mode === 'grid') return 'Grid';
  if (layout?.mode === 'horizontal') return 'Row';
  if (layout?.mode === 'vertical') return 'Stack';
  return 'Group';
}

const majorityShape = (children: SceneNode[]) => {
  const counts = new Map<string, number>();
  // Items of one list often differ deeper down (a badge, a second price), so compare two levels.
  const shallow = (n: SceneNode) =>
    `${n.kind}:${n.source.tag}(${n.children.map((c) => `${c.kind}:${c.source.tag}`).join(',')})`;
  for (const c of children) counts.set(shallow(c), (counts.get(shallow(c)) ?? 0) + 1);
  return Math.max(0, ...counts.values());
};
const isGridLike = (children: SceneNode[]) =>
  new Set(children.map((c) => Math.round(c.bounds.y))).size > 1 &&
  new Set(children.map((c) => Math.round(c.bounds.x))).size > 1;

function derive(
  node: SceneNode,
  parent: SceneNode | undefined,
  depth: number,
  top: number,
): string {
  const tag = node.source.tag;
  if (node.kind === 'text') return short(node.text?.characters || 'Text');
  if (node.kind === 'svg') return 'Icon';
  if (tag === '#background') return 'Background';
  if (node.kind === 'image')
    return node.name === 'Icon' ? 'Icon' : tag === 'video' ? 'Video' : 'Image';
  const label = textOf(node);
  const first = textOf(node, 1);
  const role = node.source.role ? ROLES[node.source.role] : undefined;
  const base = role ?? TAGS[tag];
  const images = count(node, (n) => n.kind === 'image');
  const texts = count(node, (n) => n.kind === 'text');
  if (base === 'Button' || base === 'Link' || base === 'Tab' || base === 'Menu item') {
    // A link wrapping a picture and copy is a card, not a text link.
    if (images > 0 && first && node.bounds.height > 120) return `Card / ${short(first, 32)}`;
    if (!label) return count(node, (n) => n.kind === 'svg') ? `${base} / Icon` : base;
    return `${base} / ${short(label, 32)}`;
  }
  if (/^Heading/.test(base ?? '') || base === 'Paragraph' || base === 'Label')
    return label ? `${base} / ${short(label, 32)}` : base!;
  if (base && base !== 'Section') return base;
  const wide = node.bounds.width >= (parent?.bounds.width ?? 0) * 0.9;
  const links = count(node, (n) => n.source.tag === 'a' || n.source.role === 'link');
  if (depth <= 3 && wide && node.bounds.y - top < 12 && node.bounds.height < 240 && links >= 2)
    return 'Header';
  const heading = (() => {
    let found: string | undefined;
    const walk = (n: SceneNode) => {
      if (found || n.bounds.y - node.bounds.y > 240) return;
      if (/^h[1-3]$/.test(n.source.tag) && (n.text?.characters || textOf(n)))
        found = n.text?.characters || textOf(n);
      n.children.forEach(walk);
    };
    walk(node);
    return found;
  })();
  // Page bands become sections named after their heading.
  if (base === 'Section' || (depth <= 4 && wide && node.bounds.height > 160 && heading))
    return heading ? `Section / ${short(heading, 32)}` : 'Section';
  const children = node.children.filter((c) => c.source.tag !== '#background');
  // Several siblings with mostly the same structure: a list or grid of items.
  if (children.length >= 3 && majorityShape(children) >= Math.max(3, children.length * 0.6))
    return node.layout?.mode === 'grid' || isGridLike(children) ? 'Grid' : 'List';
  if (
    parent &&
    parent.children.filter((c) => shape(c) === shape(node)).length >= 2 &&
    images > 0 &&
    texts > 0
  )
    return first ? `Card / ${short(first, 32)}` : 'Card';
  if (children.length === 1 && children[0]!.kind === 'image' && !texts) return 'Image';
  if (!children.length) return node.style.background || node.style.gradients ? 'Shape' : 'Spacer';
  if (
    texts &&
    !images &&
    node.layout?.mode !== 'horizontal' &&
    children.every((c) => c.kind === 'text')
  )
    return 'Text block';
  return layoutName(node);
}

/**
 * Replaces utility-class and tag names with names that describe what each layer is.
 * Names written by the site author (aria-label, id, descriptive classes) are kept.
 */
export function nameLayers(root: SceneNode): void {
  const walk = (node: SceneNode, parent: SceneNode | undefined, depth: number) => {
    // Children first, so containers can use their children's final structure.
    node.children.forEach((child) => walk(child, node, depth + 1));
    if (depth === 0) return;
    const tag = node.source.tag;
    const kept =
      node.kind !== 'text' &&
      tag !== '#background' &&
      !node.name.startsWith('Image / ') &&
      !node.name.startsWith('Decoration') &&
      isMeaningfulName(node.name, tag);
    if (kept) {
      // Descriptive classes read better as words; author labels stay verbatim.
      if (/^[A-Za-z][\w-]+$/.test(node.name) && /[-_]|[a-z][A-Z]/.test(node.name))
        node.name = humanize(node.name);
      const base = node.source.role ? ROLES[node.source.role] : TAGS[tag];
      if ((base === 'Button' || base === 'Link') && !node.name.startsWith(base))
        node.name = `${base} / ${node.name}`;
      return;
    }
    if (node.name.startsWith('Decoration')) return;
    node.name = derive(node, parent, depth, root.bounds.y).slice(0, 100);
    // Items of a list or grid that hold a picture and copy are cards.
    if (node.name === 'Grid' || node.name === 'List')
      for (const child of node.children) {
        const title = textOf(child, 1);
        if (
          child.kind === 'frame' &&
          !child.name.startsWith('Card') &&
          count(child, (n) => n.kind === 'image') > 0 &&
          title
        )
          child.name = `Card / ${short(title, 32)}`;
      }
    // A card whose only link repeats the card title: the link is the card's hit area.
    if (node.name.startsWith('Card / '))
      for (const child of node.children)
        if (child.name === node.name) child.name = child.name.replace(/^Card/, 'Link');
  };
  walk(root, undefined, 0);
}
