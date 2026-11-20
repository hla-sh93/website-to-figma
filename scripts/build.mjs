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
if (await readFile('src/plugin/main.ts', 'utf8').catch(() => null)) {
  const client = await build({
    entryPoints: ['src/plugin/ui.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
  });
  const ui = (await readFile('src/plugin/ui.html', 'utf8'))
    .replace('__BUILD_VERSION__', version)
    .replace('<!--SCRIPT-->', '<script>' + client.outputFiles[0].text + '</script>');
  await writeFile('dist/ui.html', ui);
  await build({
    entryPoints: ['src/plugin/main.ts'],
    outfile: 'dist/code.js',
    bundle: true,
    format: 'iife',
    target: 'es2020',
    define: { __html__: JSON.stringify(ui) },
  });
  await copyFile('src/plugin/manifest.json', 'dist/manifest.json');
}
console.log('Built native renderer and available plugin entry points.');
