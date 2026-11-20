import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const directory = new URL('../../.data/', import.meta.url);
const path = new URL('plugin-key', directory);
/** Private per-install credential, excluded from source and release archives. */
export async function localPairingKey() {
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{48}$/.test(key)) throw new Error('Invalid local plugin pairing file.');
  return key;
}
