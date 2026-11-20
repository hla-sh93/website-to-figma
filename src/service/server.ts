import { createLocalService } from './app.js';
import { localPairingKey } from './pairing.js';
const port = Number(process.env.PORT ?? 4017);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be between 1024 and 65535.');
const app = await createLocalService({ port, pairingKey: await localPairingKey() });
console.log(
  `Website to Figma · By Hla.Sh\nOpen ${app.url} for the session code and capture dashboard.\nLocal service only; keep this terminal running while using the plugin.`,
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
