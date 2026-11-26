import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assignSiteFonts,
  fontNames,
  parseFontFaces,
  saveSiteFonts,
  toInstallableFont,
} from '../src/capture/site-fonts.js';
import { resolveFont, fontRequest } from '../src/plugin/fonts.js';
import type { SceneNode, TextSpec } from '../src/core/scene.js';

/** A minimal sfnt holding only a name table (family, style), enough to be named. */
function tinyFont(family: string, style: string): Uint8Array {
  const utf16 = (value: string) => Buffer.from([...value].flatMap((c) => [0, c.charCodeAt(0)]));
  const strings = [
    [1, utf16(family)],
    [2, utf16(style)],
  ] as const;
  const header = Buffer.alloc(6 + strings.length * 12);
  header.writeUInt16BE(strings.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  strings.forEach(([id, bytes], i) => {
    const at = 6 + i * 12;
    header.writeUInt16BE(3, at); // Windows
    header.writeUInt16BE(1, at + 2);
    header.writeUInt16BE(0x409, at + 4);
    header.writeUInt16BE(id, at + 6);
    header.writeUInt16BE(bytes.length, at + 8);
    header.writeUInt16BE(offset, at + 10);
    offset += bytes.length;
  });
  const name = Buffer.concat([header, ...strings.map(([, bytes]) => bytes)]);
  const padded = Buffer.concat([name, Buffer.alloc((4 - (name.length % 4)) % 4)]);
  const directory = Buffer.alloc(12 + 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(1, 4);
  directory.write('name', 12, 'latin1');
  directory.writeUInt32BE(28, 12 + 8);
  directory.writeUInt32BE(name.length, 12 + 12);
  return new Uint8Array(Buffer.concat([directory, padded]));
}
/** The same font wrapped as WOFF 1 with its table deflated. */
function asWoff(font: Uint8Array): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const offset = view.getUint32(12 + 8),
    length = view.getUint32(12 + 12);
  const table = deflateSync(font.subarray(offset, offset + length));
  const out = Buffer.alloc(44 + 20 + table.length);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt16BE(1, 12);
  out.write('name', 44, 'latin1');
  out.writeUInt32BE(64, 44 + 4);
  out.writeUInt32BE(table.length, 44 + 8);
  out.writeUInt32BE(length, 44 + 12);
  table.copy(out, 64);
  return new Uint8Array(out);
}

test('a web font becomes an installable file named by its own family and style', async () => {
  const font = tinyFont('Brand Sans Web', 'Book');
  assert.deepEqual(fontNames(font), { family: 'Brand Sans Web', style: 'Book' });
  const unpacked = await toInstallableFont(asWoff(font));
  assert.deepEqual(fontNames(unpacked!), { family: 'Brand Sans Web', style: 'Book' });
  assert.equal(
    await toInstallableFont(new Uint8Array(Buffer.from('<html>not a font</html>'))),
    undefined,
  );

  const folder = await mkdtemp(join(tmpdir(), 'site-fonts-'));
  try {
    const saved = await saveSiteFonts(folder, 'www.example.com', [
      ['https://cdn.example.com/a.woff', asWoff(font)],
      ['https://cdn.example.com/a-copy.woff', asWoff(font)],
      ['https://cdn.example.com/../evil.woff', asWoff(tinyFont('../../Escape', 'Regular'))],
    ]);
    assert.deepEqual(
      saved!.files.map((f) => f.file),
      ['Brand Sans Web-Book.ttf', 'Escape-Regular.ttf'],
    );
    assert.ok(saved!.folder.startsWith(folder));
    assert.equal(
      saved!.byUrl.get('https://cdn.example.com/a-copy.woff')!.file,
      'Brand Sans Web-Book.ttf',
    );
    assert.deepEqual(
      fontNames(new Uint8Array(await readFile(join(saved!.folder, 'Brand Sans Web-Book.ttf')))),
      { family: 'Brand Sans Web', style: 'Book' },
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('@font-face rules link the name a page uses to the saved file', () => {
  const rules = parseFontFaces(
    `@font-face{font-family:"Brand Sans";font-weight:300;src:url(/f/book.woff2) format("woff2"),url("book.woff")}
     @font-face { font-family: Brand Sans; font-weight: 600; font-style: italic; src: url('https://cdn.example.com/semi-it.woff2') }
     @font-face{font-family:Flex;font-weight:100 900;src:url(data:font/woff2;base64,AAAA)}`,
    'https://www.example.com/css/site.css',
  );
  assert.deepEqual(
    rules.map((r) => [r.family, r.weight, r.italic, r.urls]),
    [
      [
        'Brand Sans',
        [300, 300],
        false,
        ['https://www.example.com/f/book.woff2', 'https://www.example.com/css/book.woff'],
      ],
      ['Brand Sans', [600, 600], true, ['https://cdn.example.com/semi-it.woff2']],
    ],
  );
  const text = (extra: Partial<TextSpec>): TextSpec => ({
    characters: 'x',
    fontFamily: '"Brand Sans", Arial, sans-serif',
    fontStyle: 'normal',
    fontWeight: 300,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
    align: 'left',
    direction: 'ltr',
    ...extra,
  });
  const node = (id: string, spec: TextSpec): SceneNode => ({
    id,
    name: id,
    kind: 'text',
    source: { tag: 'p' },
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    style: { opacity: 1 },
    position: 'flow',
    children: [],
    text: spec,
  });
  const book = node('book', text({}));
  const other = node('other', text({ fontFamily: 'Arial, sans-serif' }));
  assignSiteFonts(
    [book, other],
    rules,
    new Map([
      [
        'https://www.example.com/f/book.woff2',
        { family: 'Brand Sans Web', style: 'Book', file: 'Brand Sans Web-Book.otf' },
      ],
    ]),
  );
  assert.equal(book.text!.resolvedFontFamily, 'Brand Sans Web');
  assert.equal(book.text!.resolvedFontStyle, 'Book');
  assert.equal(other.text!.resolvedFontFamily, undefined);
  // A variable font: the family is known, the style is left to the weight.
  const bold = node('bold', text({ fontWeight: 700 }));
  assignSiteFonts(
    [bold],
    parseFontFaces(
      '@font-face{font-family:Brand Sans;font-weight:200 900;src:url(v.woff2)}',
      'https://x.test/',
    ),
    new Map([
      ['https://x.test/v.woff2', { family: 'Brand Sans', style: 'Regular', file: 'v.ttf' }],
    ]),
  );
  assert.equal(bold.text!.resolvedFontFamily, 'Brand Sans');
  assert.equal(bold.text!.resolvedFontStyle, undefined);

  // Installed under its own name, the face is exact although "Book" is not a weight name.
  const request = fontRequest(book.text!);
  const inter = { family: 'Inter', style: 'Regular' };
  assert.equal(resolveFont(request, [inter]).exact, false);
  const installed = resolveFont(request, [inter, { family: 'Brand Sans Web', style: 'Book' }]);
  assert.deepEqual(installed, { font: { family: 'Brand Sans Web', style: 'Book' }, exact: true });
  // Already in the editor under the name the page uses (a Google font): also exact.
  assert.equal(resolveFont(request, [inter, { family: 'Brand Sans', style: 'Light' }]).exact, true);
});
