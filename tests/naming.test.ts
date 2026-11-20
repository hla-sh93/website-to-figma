import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeaningfulName, nameLayers } from '../src/core/naming.js';
import type { SceneNode } from '../src/core/scene.js';

let ids = 0;
const node = (name: string, tag: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  id: `n${++ids}`,
  name,
  kind: 'frame',
  source: { tag },
  bounds: { x: 0, y: 0, width: 100, height: 40 },
  style: { opacity: 1 },
  children: [],
  ...extra,
});
const text = (characters: string, tag = '#text'): SceneNode =>
  node('text', tag, {
    kind: 'text',
    text: {
      characters,
      fontFamily: 'Inter',
      fontStyle: 'normal',
      fontWeight: 400,
      fontSize: 16,
      lineHeight: 20,
      letterSpacing: 0,
      color: { r: 0, g: 0, b: 0, a: 1 },
      align: 'left',
      direction: 'ltr',
    },
  });
const image = () => node('Image / img', 'img', { kind: 'image' });

test('utility classes, generated hashes and tag names are not layer names', () => {
  for (const name of [
    'flex',
    'w-4',
    'mx-auto',
    '-mx-4',
    'size-17',
    'py-1.5',
    'bg-primary-300/40',
    'aspect-[10/11]',
    'hover:underline',
    'max-sm:hidden',
    '__variable_1f41d9',
    'css-1x2y3z',
    'div',
    'span',
    'group',
  ])
    assert.equal(isMeaningfulName(name), false, name);
  for (const name of ['product-card', 'site-header', 'Open menu', 'القائمة', 'heroBanner'])
    assert.equal(isMeaningfulName(name), true, name);
});

test('layers get names that describe their role and content', () => {
  const card = (title: string) =>
    node('relative', 'div', {
      bounds: { x: 0, y: 100, width: 200, height: 300 },
      children: [image(), text(title), text('SYP 34,000')],
    });
  const root = node('root', 'document', {
    bounds: { x: 0, y: 0, width: 1440, height: 2000 },
    children: [
      node('__variable_1f41d9', 'body', {
        bounds: { x: 0, y: 0, width: 1440, height: 2000 },
        children: [
          node('flex', 'div', {
            bounds: { x: 0, y: 0, width: 1440, height: 80 },
            children: [
              node('a', 'a', { children: [text('الرئيسية')] }),
              node('a', 'a', { children: [text('المنتجات')] }),
              node('w-4', 'svg', { kind: 'svg' }),
            ],
          }),
          node('mx-auto', 'div', {
            bounds: { x: 0, y: 100, width: 1440, height: 700 },
            layout: {
              mode: 'grid',
              gap: 16,
              padding: [0, 0, 0, 0],
              align: 'start',
              justify: 'start',
              wrap: false,
              widthSizing: 'fixed',
              heightSizing: 'hug',
              columns: 3,
            },
            children: [card('Nike Air Jordan 4'), card('Converse'), card('Samba')],
          }),
          node('open-menu', 'button', { children: [node('w-7', 'svg', { kind: 'svg' })] }),
          node('Open menu', 'button', {}),
        ],
      }),
    ],
  });
  nameLayers(root);
  const body = root.children[0]!;
  assert.equal(body.name, 'Page');
  const [header, grid, iconButton, labelled] = body.children;
  assert.equal(header!.name, 'Header');
  assert.deepEqual(
    header!.children.map((c) => c.name),
    ['Link / الرئيسية', 'Link / المنتجات', 'Icon'],
  );
  assert.equal(grid!.name, 'Grid');
  assert.deepEqual(
    grid!.children.map((c) => c.name),
    ['Card / Nike Air Jordan 4', 'Card / Converse', 'Card / Samba'],
  );
  assert.deepEqual(
    grid!.children[0]!.children.map((c) => c.name),
    ['Image', 'Nike Air Jordan 4', 'SYP 34,000'],
  );
  assert.equal(iconButton!.name, 'Button / Open menu');
  assert.equal(labelled!.name, 'Button / Open menu');
  assert.equal(root.name, 'root');
});
