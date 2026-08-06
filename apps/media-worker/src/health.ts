import { createServer, type Server } from 'node:http';

export interface HealthState {
  ready: boolean;
  lastClaimAttemptAt: Date | null;
  lastError: string | null;
}

// Deliberately minimal: Fly.io (or any container platform's) HTTP
// healthcheck just needs a 200 while the worker's poll loop is alive.
// /health also echoes the last poll/error timestamps so a `curl` during
// local Docker testing can distinguish "healthy but idle queue" from
// "stuck".
export function startHealthServer(port: number, state: HealthState): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(state.ready ? 200 : 503, {
      'content-type': 'application/json',
    });
    res.end(
      JSON.stringify({
        ready: state.ready,
        lastClaimAttemptAt: state.lastClaimAttemptAt?.toISOString() ?? null,
        lastError: state.lastError,
      }),
    );
  });
  server.listen(port);
  return server;
}
