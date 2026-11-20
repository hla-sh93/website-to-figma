import { readFile, writeFile } from 'node:fs/promises';
const index = process.argv.indexOf('--id'),
  id = index >= 0 ? process.argv[index + 1] : undefined;
if (!id || !/^\d{6,30}$/.test(id))
  throw new Error(
    'Pass the plugin ID assigned by Figma: npm run configure-plugin -- --id YOUR_FIGMA_PLUGIN_ID',
  );
const path = 'src/plugin/manifest.json',
  manifest = JSON.parse(await readFile(path, 'utf8'));
manifest.id = id;
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  'Saved the Figma-assigned plugin ID. Run npm run build before importing dist/manifest.json.',
);
