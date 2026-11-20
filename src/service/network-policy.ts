import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type DnsRecord = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<DnsRecord[]>;
const resolve: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** Conservative globally routable-only policy. Transition/tunnel IPv6 is rejected. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if ((a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)) return false;
    if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    const first = parseInt(normalized.split(':')[0] ?? '', 16);
    if (!(first >= 0x2000 && first <= 0x3fff)) return false;
    if (/^2002:|^2001:(db8|0|10|20)(:|$)/.test(normalized)) return false;
    return true;
  }
  return false;
}

export function validateTarget(input: string): URL {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Invalid website URL.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS website URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP and HTTPS websites are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port))
    throw new Error('Only standard web ports are allowed.');
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    (!hostname.includes('.') && !isIP(hostname))
  ) {
    throw new Error('Local and internal website addresses are not allowed.');
  }
  if (isIP(hostname) && !isPublicAddress(hostname))
    throw new Error('Website must have a public address.');
  return url;
}

export async function resolvePublicTarget(
  input: string,
  resolver: Resolver = resolve,
): Promise<{ url: URL; addresses: DnsRecord[] }> {
  const url = validateTarget(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname);
  if (!addresses.length) throw new Error('Website address could not be resolved.');
  if (addresses.some((record) => !isPublicAddress(record.address)))
    throw new Error('Website resolved to a private or non-public address.');
  return { url, addresses };
}

export async function assertPublicUrl(input: string, resolver: Resolver = resolve): Promise<URL> {
  return (await resolvePublicTarget(input, resolver)).url;
}
