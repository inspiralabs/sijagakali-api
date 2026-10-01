import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

/** Server HTTP sementara di 127.0.0.1 port acak, khusus test. */
export async function startTestServer(
  handler: http.RequestListener
): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
