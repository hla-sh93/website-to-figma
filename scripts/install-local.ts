import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { localPairingKey } from '../src/service/pairing.js';
const index = process.argv.indexOf('--target');
if (index < 0 || !process.argv[index + 1])
  throw new Error('Pass the registered plugin folder with --target.');
const target = resolve(process.argv[index + 1]!);
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const registered = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
if (manifest.id !== registered.id || !/^\d{6,30}$/.test(manifest.id))
  throw new Error('The built identity must match the registered Figma plugin.');
const backup = resolve(
  'output/desktop-registration-backup',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await mkdir(backup, { recursive: true });
const names = ['manifest.json', 'code.js', 'ui.html'];
for (const name of names) await copyFile(join(target, name), join(backup, name));
const key = await localPairingKey();
const verifyIndex = process.argv.indexOf('--verify-url');
const fixtureIndex = process.argv.indexOf('--verify-fixture');
const fixture = fixtureIndex < 0 ? '' : process.argv[fixtureIndex + 1];
if (fixture && !['reference', 'features'].includes(fixture))
  throw new Error('Choose the reference or features owned fixture.');
if (fixtureIndex >= 0 && !fixture) throw new Error('Pass an owned fixture name.');
if (fixture && verifyIndex >= 0) throw new Error('Choose one verification URL or fixture.');
const verifyUrl = fixture
  ? 'fixture:' + fixture
  : verifyIndex < 0
    ? ''
    : (process.argv[verifyIndex + 1] ?? '');
if (verifyUrl && !fixture) {
  const url = new URL(verifyUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Verification requires a public HTTP(S) URL.');
}
const sourceDir = verifyUrl ? 'dist/diagnostic' : 'dist';
const checks = [];
for (const name of names) {
  let bytes = await readFile(join(sourceDir, name));
  // Both halves carry the private channel key: code.js (main) and ui.html (iframe).
  if (name === 'code.js' || name === 'ui.html') {
    const code = bytes.toString();
    if (!code.includes('__HLA_LOCAL_PAIRING_KEY__'))
      throw new Error(`Pairing placeholder missing in ${name}; rebuild first.`);
    bytes = Buffer.from(
      code
        .replaceAll('__HLA_LOCAL_PAIRING_KEY__', key)
        .replaceAll('__HLA_VERIFICATION_URL__', encodeURIComponent(verifyUrl)),
    );
    if (bytes.toString().includes('__HLA_LOCAL_PAIRING_KEY__'))
      throw new Error(`Pairing placeholder left in ${name}.`);
  }
  await writeFile(join(target, name), bytes);
  const deployed = await readFile(join(target, name));
  if (!bytes.equals(deployed)) throw new Error('Deployed bytes differ: ' + name);
  checks.push({
    name,
    bytes: deployed.length,
    sha256: createHash('sha256').update(deployed).digest('hex'),
  });
}
const report = {
  status: 'deployed',
  pluginId: manifest.id,
  registeredDirectory: target,
  backupDirectory: backup,
  version: JSON.parse(await readFile('package.json', 'utf8')).version,
  personalized: true,
  verificationMode: Boolean(verifyUrl),
  ...(fixture ? { verificationFixture: fixture } : {}),
  files: checks,
};
await writeFile('output/desktop-deployment.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
