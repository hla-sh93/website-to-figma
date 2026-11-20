import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolvePublicTarget, type Resolver } from './network-policy.js';

/** All browser HTTP(S) leaves through this proxy. DNS is validated, then the
 * socket connects to that exact IP, preventing a second lookup/rebinding race. */
export async function startEgressProxy(options: { resolver?: Resolver; maxBytes?: number } = {}) {
  const username = 'capture';
  const password = randomBytes(24).toString('hex');
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sockets = new Set<net.Socket>();
  const blocked: string[] = [];
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  let bytes = 0;
  let requests = 0;
  const authorize = (headers: http.IncomingHttpHeaders) =>
    headers['proxy-authorization'] === expected;
  const count = (socket: net.Socket) => {
    sockets.add(socket);
    socket.setTimeout(20000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) for (const active of sockets) active.destroy();
    });
  };
  const target = async (input: string) => {
    if (++requests > 1500) throw new Error('Capture network request limit reached.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        resolvePublicTarget(input, options.resolver),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS timeout.')), 4000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const server = http.createServer(async (req, res) => {
    if (!authorize(req.headers)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="capture"' });
      res.end();
      return;
    }
    try {
      const { url, addresses } = await target(req.url ?? '');
      if (url.protocol !== 'http:') throw new Error('Use an HTTPS tunnel.');
      const address = addresses[0]!;
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request(
        {
          hostname: address.address,
          family: address.family,
          port: Number(url.port) || 80,
          path: url.pathname + url.search,
          method: req.method,
          headers,
          agent: false,
          timeout: 20000,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('socket', count);
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout.')));
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    } catch (error) {
      blocked.push(error instanceof Error ? error.message : 'Blocked request');
      res.writeHead(403);
      res.end('Capture destination blocked.');
    }
  });
  server.on('connection', count);
  server.on('connect', async (req, client, head) => {
    const socket = client as net.Socket;
    if (!authorize(req.headers)) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="capture"\r\n\r\n',
      );
      return;
    }
    try {
      const { url, addresses } = await target(`https://${req.url ?? ''}`);
      if (url.port && url.port !== '443')
        throw new Error('Only HTTPS tunnels on port 443 are supported.');
      const upstream = net.connect(
        { host: addresses[0]!.address, family: addresses[0]!.family, port: 443 },
        () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        },
      );
      count(upstream);
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
    } catch (error) {
      blocked.push(error instanceof Error ? error.message : 'Blocked tunnel');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    username,
    password,
    blocked,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
