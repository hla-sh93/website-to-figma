import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';

const picture =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="red"/></svg>',
  );

test('long-page image and background keep original crop geometry at the capture boundary', async () => {
  const scene = await captureHtml(
    `<body style="margin:0;height:16200px"><img id="edge" src="${picture}" style="position:absolute;top:15900px;width:100px;height:200px"><div id="background" style="position:absolute;left:120px;top:15900px;width:100px;height:200px;background:url('${picture}') no-repeat"></div></body>`,
    { widths: [390] },
  );
  const nodes = flatten(scene.screens[0]!.root);
  assert.equal(scene.screens[0]!.root.bounds.height, 16000);
  assert.equal(scene.screens[0]!.root.layout!.heightSizing, 'fixed');
  const edge = nodes.find((n) => n.source.key === 'edge')!;
  assert.equal(edge.bounds.height, 200);
  assert.equal(edge.image!.contentBox!.height, 200);
  assert.ok(nodes.some((n) => n.source.key === 'background/background' && n.kind === 'image'));
  assert.ok(scene.issues.some((i) => i.code === 'height-truncated'));
});

test('nested unboxed content retains interleaved direct text exactly once', async () => {
  const scene = await captureHtml(
    `<body><section style="display:flex"><img src="${picture}" width="20" height="20"><div style="display:contents">Before <span>Middle</span><div style="display:contents">After <b>End</b></div></div></section></body>`,
    { widths: [390] },
  );
  const texts = flatten(scene.screens[0]!.root)
    .filter((n) => n.text)
    .map((n) => n.text!.characters);
  assert.deepEqual(
    texts.map((s) => s.trim()),
    ['Before', 'Middle', 'After', 'End'],
  );
});

test('preformatted text preserves indentation, trailing spaces and line breaks', async () => {
  for (const whitespace of ['pre', 'pre-wrap', 'break-spaces']) {
    const scene = await captureHtml(
      `<body><div id="code" style="white-space:${whitespace}">  Indented\nTrailing  \n</div></body>`,
      { widths: [390] },
    );
    assert.equal(
      flatten(scene.screens[0]!.root).find((n) => n.source.key === 'code')!.text!.characters,
      '  Indented\nTrailing  \n',
    );
  }
});

test('inline SVG preserves inherited currentColor and CSS paint as independent asset pixels', async () => {
  const scene = await captureHtml(
    '<style>.icon{color:rgb(0,180,0)}.icon rect{fill:currentColor}</style><body><svg class="icon" width="20" height="20"><rect width="20" height="20"/></svg></body>',
    { widths: [390] },
  );
  const svg = scene.assets.find((a) => a.kind === 'svg')!;
  const { data } = await sharp(Buffer.from(svg.data, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 4)], [0, 180, 0, 255]);
});

test('fixed CSS grids keep measured geometry while unequal gaps remain explicit', async () => {
  const scene = await captureHtml(
    '<style>body{margin:0}.grid{display:grid;grid-template-columns:100px 100px;gap:10px 40px}.card{height:40px}</style><body><div class="grid" id="grid"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div></body>',
    { widths: [390] },
  );
  const grid = flatten(scene.screens[0]!.root).find((n) => n.source.key === 'grid')!;
  assert.equal(grid.layout!.gap, 40);
  assert.equal(grid.layout!.rowGap, 10);
  assert.equal(grid.layout!.mode, 'none');
  assert.equal(grid.children[1]!.bounds.x, 140);
  assert.ok(scene.issues.some((i) => i.code === 'layout-fixed-unsupported'));
});

test('styled inline content discloses unsupported box and opacity instead of silent fidelity loss', async () => {
  const scene = await captureHtml(
    '<body><p>Normal <span style="background:yellow;opacity:.2">Styled inline</span></p></body>',
    { widths: [390] },
  );
  assert.ok(scene.issues.some((i) => i.code === 'inline-style-unsupported'));
});

test('live form values are retained while native control appearance is disclosed', async () => {
  const scene = await captureHtml(
    '<body><input value="Input value"><textarea id="edited">Initial</textarea><select><option>First</option><option selected>Chosen</option></select><script>document.getElementById("edited").value="Live value";</script></body>',
    { widths: [390] },
  );
  const text = flatten(scene.screens[0]!.root)
    .filter((n) => n.text)
    .map((n) => n.text!.characters)
    .join('|');
  assert.ok(text.includes('Input value'));
  assert.ok(text.includes('Live value'));
  assert.ok(text.includes('Chosen'));
  assert.ok(!text.includes('Initial'));
  assert.ok(scene.issues.some((i) => i.code === 'form-control-appearance'));
});

test('a human verification interstitial fails instead of importing it as the requested page', async () => {
  await assert.rejects(
    captureHtml(
      '<title>Robot Check</title><body><h1>Verify you are human</h1><form action="/errors/validateCaptcha"><input id="captchacharacters"><button>Continue</button></form></body>',
      { widths: [390] },
    ),
    /PAGE_BLOCKED/,
  );
});

test('same-length changing text is not mistaken for a stable page', async () => {
  await assert.rejects(
    captureHtml(
      '<body><p id="ticker" style="font-family:monospace">AAAA</p><script>let phase=false;setInterval(()=>{document.getElementById("ticker").textContent=(phase=!phase)?"BBBB":"AAAA"},180)</script></body>',
      { widths: [390] },
    ),
    /لم يستقر|تغيّر/,
  );
});

test('a page containing only a text control is meaningful and password text is masked', async () => {
  const scene = await captureHtml(
    '<body><input value="Only field"><input type="password" value="Never expose me"></body>',
    { widths: [390] },
  );
  const texts = flatten(scene.screens[0]!.root)
    .filter((n) => n.text)
    .map((n) => n.text!.characters);
  assert.ok(texts.includes('Only field'));
  assert.ok(texts.includes('•'.repeat('Never expose me'.length)));
  assert.ok(!JSON.stringify(scene).includes('Never expose me'));
});

test('intrinsic single-line text keeps auto width while constrained copy remains able to wrap', async () => {
  const scene = await captureHtml(
    '<style>body{font:14px Arial}button{display:inline-flex;padding:12px 24px;font:700 14px Arial}section{display:flex;justify-content:space-between}h2{font-size:36px;letter-spacing:-1px}p{width:98px}</style><body><button id="action">Explore Forma</button><section><div><h2 id="heading">Good work starts here.</h2></div><span>Side</span></section><p id="fixed">Explore Forma with a longer label</p></body>',
    { widths: [1440] },
  );
  const nodes = flatten(scene.screens[0]!.root);
  const button = nodes.find((n) => n.source.key === 'action')!;
  assert.equal(button.children.find((n) => n.kind === 'text')!.text!.sizing, 'inline');
  assert.equal(nodes.find((n) => n.source.key === 'heading')!.text!.sizing, 'inline');
  assert.equal(nodes.find((n) => n.source.key === 'fixed')!.text!.sizing, 'block');
});
