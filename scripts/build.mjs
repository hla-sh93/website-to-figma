import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/plugin/renderer.ts'],
  outfile: 'dist/renderer.js',
  bundle: true,
  format: 'iife',
  globalName: 'WebsiteRenderer',
  target: 'es2020',
});
await build({
  entryPoints: ['src/plugin/renderer.ts'],
  outfile: 'dist/renderer.min.js',
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'WebsiteRenderer',
  target: 'es2020',
});
await build({
  entryPoints: ['tests/native-validation.ts'],
  outfile: 'dist/native-validation.js',
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'WebsiteValidation',
  target: 'es2020',
});
await build({
  entryPoints: ['tests/native-fidelity.ts'],
  outfile: 'dist/native-fidelity.js',
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'WebsiteFidelity',
  target: 'es2020',
});
// The shipped plugin excludes verification hooks; the diagnostic build keeps
// them for owned-fixture and native acceptance runs.
for (const [dir, diagnostics] of [
  ['dist', false],
  ['dist/diagnostic', true],
]) {
  await mkdir(dir, { recursive: true });
  const define = { __DIAGNOSTICS__: String(diagnostics) };
  const client = await build({
    entryPoints: ['src/plugin/ui.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    define,
    minifySyntax: true,
    write: false,
  });
  const ui = (await readFile('src/plugin/ui.html', 'utf8'))
    .replace('__BUILD_VERSION__', version)
    .replace('<!--SCRIPT-->', '<script>' + client.outputFiles[0].text + '</script>');
  await writeFile(`${dir}/ui.html`, ui);
  // Figma supplies __html__ from the manifest's ui file; do not embed it twice.
  await build({
    entryPoints: ['src/plugin/main.ts'],
    outfile: `${dir}/code.js`,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    define,
    minifySyntax: true,
  });
  await copyFile('src/plugin/manifest.json', `${dir}/manifest.json`);
}
console.log('Built native renderer, shipped plugin and diagnostic plugin.');
