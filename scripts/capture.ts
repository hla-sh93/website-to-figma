import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { captureHtml, captureUrl } from '../src/capture/capture.js';
const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const url = value('--url'),
  fixture = value('--fixture');
if (!!url === !!fixture) throw new Error('Specify exactly one of --url or --fixture');
const out = resolve(value('--out') ?? 'output/capture.json');
const options = {
  widths: value('--widths')?.split(',').map(Number),
  selector: value('--selector'),
};
const scene = fixture
  ? await captureHtml(await readFile(resolve(fixture), 'utf8'), options)
  : await captureUrl(url!, options);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(scene, null, 2));
for (const screen of scene.screens)
  if (screen.screenshot)
    await writeFile(
      resolve(dirname(out), screen.id + '.png'),
      Buffer.from(screen.screenshot, 'base64'),
    );
console.log(
  `Captured ${scene.screens.length} screens, ${scene.assets.length} assets, ${scene.issues.length} issues.`,
);
