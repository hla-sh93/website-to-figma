import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { captureUrl } from '../src/capture/capture.js';
import { flatten } from '../src/core/analysis.js';

const rootDirectory = 'output/review-public-sites';
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const directory = join(rootDirectory, runId);
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
await mkdir(directory, { recursive: true });
const cases = [
  { id: 'amazon-home', url: 'https://www.amazon.co.uk/', widths: [1440], theme: 'light' as const },
  {
    id: 'arabic-wikipedia',
    url: 'https://ar.wikipedia.org/wiki/الصفحة_الرئيسية',
    widths: [390],
    language: 'ar' as const,
    theme: 'light' as const,
  },
  {
    id: 'mdn-grid-dark',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
    widths: [1440, 390],
    theme: 'dark' as const,
  },
  {
    id: 'aria-combobox',
    url: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/',
    widths: [390],
    theme: 'light' as const,
  },
];
const results = [];
for (const item of cases) {
  const started = Date.now();
  try {
    const scene = await captureUrl(item.url, item);
    const folder = join(directory, item.id);
    await mkdir(folder, { recursive: true });
    const serialized = JSON.stringify(scene);
    await writeFile(join(folder, 'capture.json'), serialized);
    for (const screen of scene.screens)
      await writeFile(join(folder, screen.id + '.png'), Buffer.from(screen.screenshot!, 'base64'));
    const result = {
      id: item.id,
      url: item.url,
      status: 'source-captured',
      artifactDirectory: folder,
      sourceHash: createHash('sha256').update(serialized).digest('hex'),
      durationMs: Date.now() - started,
      title: scene.capture.title,
      screens: scene.screens.map((screen) => {
        const nodes = flatten(screen.root);
        return {
          width: screen.viewport.width,
          height: screen.root.bounds.height,
          nodes: nodes.length,
          text: nodes.filter((n) => n.kind === 'text').length,
          images: nodes.filter((n) => n.kind === 'image').length,
          vectors: nodes.filter((n) => n.kind === 'svg').length,
        };
      }),
      issues: Object.fromEntries(
        [...new Set(scene.issues.map((i) => i.code))].map((code) => [
          code,
          scene.issues.filter((i) => i.code === code).length,
        ]),
      ),
      nativeFigma: 'not-tested-by-this-script',
      visualAcceptance: 'not-assessed',
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = {
      id: item.id,
      url: item.url,
      status: 'capture-failed',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const report = JSON.stringify(
    {
      author: 'Hla.Sh',
      version,
      runId,
      generatedAt: new Date().toISOString(),
      scope: 'Public URL source capture only. Native fidelity is measured separately.',
      results,
    },
    null,
    2,
  );
  await writeFile(join(directory, 'report.json'), report);
  await writeFile(join(rootDirectory, 'report.json'), report);
}
