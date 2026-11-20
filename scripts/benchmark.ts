import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { captureHtml } from '../src/capture/capture.js';
import { analyzeScene } from '../src/core/analysis.js';
import { comparePng } from '../src/quality/compare.js';
const args = process.argv.slice(2),
  arg = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const directory = resolve(arg('--out') ?? 'output/benchmark');
await mkdir(directory, { recursive: true });
if (arg('--source') && arg('--rendered')) {
  const comparison = await comparePng(
    await readFile(resolve(arg('--source')!)),
    await readFile(resolve(arg('--rendered')!)),
  );
  const { diff, overlay, ...metrics } = comparison;
  await Promise.all([
    writeFile(join(directory, 'difference.png'), diff),
    writeFile(join(directory, 'overlay.png'), overlay),
    writeFile(join(directory, 'metrics.json'), JSON.stringify(metrics, null, 2)),
  ]);
  console.log(
    `Comparison complete: ${(metrics.changedFraction * 100).toFixed(2)}% pixels above threshold; dimensions ${metrics.sizeMismatch ? 'differ' : 'match'}. This is a diagnostic, not an accuracy guarantee.`,
  );
} else {
  const scene = await captureHtml(await readFile('fixtures/reference.html', 'utf8'), {
    widths: [1440, 768, 390],
  });
  const analysis = analyzeScene(scene);
  await writeFile(join(directory, 'capture.json'), JSON.stringify(scene, null, 2));
  for (const screen of scene.screens)
    await writeFile(join(directory, screen.id + '.png'), Buffer.from(screen.screenshot!, 'base64'));
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        author: 'Hla.Sh',
        generatedAt: new Date().toISOString(),
        kind: 'Source capture and structural analysis only',
        analysis,
        issues: scene.issues,
        humanCleanupBenchmark: 'Not run',
        figmaAppearanceComparison: 'Run separately with exported source and Figma PNGs.',
      },
      null,
      2,
    ),
  );
  console.log(
    `Source benchmark: ${analysis.summary.screens} viewports, ${analysis.summary.nodes} scene nodes, ${analysis.components.length} component candidates. No Figma accuracy claim.`,
  );
}
