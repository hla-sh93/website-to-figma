import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLineBoxes } from '../src/core/text-box.js';
import type { SceneNode } from '../src/core/scene.js';

const paragraph = (extra: Partial<NonNullable<SceneNode['text']>>, height: number): SceneNode => ({
  id: 'p',
  name: 'p',
  kind: 'text',
  source: { tag: 'p' },
  bounds: { x: 0, y: 100, width: 300, height },
  style: { opacity: 1 },
  position: 'flow',
  children: [],
  text: {
    characters: 'May 5, 2026 A headline on two lines',
    fontFamily: 'Arial',
    fontStyle: 'normal',
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 16,
    letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
    align: 'left',
    direction: 'ltr',
    ...extra,
  },
});

test('lines of two heights in one paragraph: a small date above a large headline', () => {
  // The paragraph's own line height is 16; the date is 14/21, the headline 40/48 on two lines.
  const node = paragraph(
    {
      lines: 3,
      breaks: [12, 26],
      runs: [
        { start: 0, end: 11, fontSize: 14, lineHeight: 21 },
        { start: 11, end: 12, lineHeight: 16 },
        { start: 12, end: 35, fontSize: 40, lineHeight: 48 },
      ],
    },
    141,
  );
  textLineBoxes(node);
  // 21 + 48 + 48, centred on the measured 141 px box; not three lines of 16.
  assert.equal(node.bounds.height, 117);
  assert.equal(node.bounds.y, 112);
});

test('one line height throughout: the lines times the line height', () => {
  const node = paragraph({ lines: 3, breaks: [12, 26], lineHeight: 20 }, 64);
  textLineBoxes(node);
  assert.equal(node.bounds.height, 60);
});
