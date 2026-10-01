// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { MCPClient } from '../client';

// HTTP regressions exercise the SDK on the wire; stdio compatibility is covered
// by index.test.ts against the repository's mcp-hello-world dependency.
describe('MCP HTTP protocol negotiation', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it.each(['2026-07-28', '2025-11-25'])('lists and calls tools on %s', async (version) => {
    const requests: Array<{ body: any; authorization?: string }> = [];
    const tool = { name: 'echo', inputSchema: { type: 'object' as const } };
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(req.method === 'DELETE' ? 200 : 405).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      requests.push({ body: message, authorization: req.headers.authorization });
      if (!('id' in message)) {
        res.writeHead(202).end();
        return;
      }
      let result: unknown;
      let error: unknown;
      switch (message.method) {
        case 'server/discover': {
          if (version === '2026-07-28') {
            result = {
              supportedVersions: [version],
              capabilities: { tools: {} },
              _meta: {
                'io.modelcontextprotocol/serverInfo': { name: 'protocol-test', version: '1.0.0' },
              },
            };
          } else error = { code: -32601, message: 'Method not found' };
          break;
        }
        case 'initialize': {
          result = {
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: 'protocol-test', version: '1.0.0' },
          };
          break;
        }
        case 'tools/list': {
          result = {
            tools: [tool],
            ...(version === '2026-07-28' ? { ttlMs: 0, cacheScope: 'private' } : {}),
          };
          break;
        }
        case 'tools/call': {
          result = { content: [{ type: 'text', text: message.params.arguments.message }] };
          break;
        }
        default: {
          error = { code: -32601, message: 'Method not found' };
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          ...(error
            ? { error }
            : {
                result:
                  version === '2026-07-28'
                    ? { ...(result as object), resultType: 'complete' }
                    : result,
              }),
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => {
      server.closeAllConnections();
      server.close();
    });
    const client = new MCPClient({
      name: 'protocol-test',
      type: 'http',
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      auth: { type: 'bearer', token: 'protocol-test-token' },
    });
    await client.initialize();
    try {
      expect(await client.listTools()).toEqual([tool]);
      expect(await client.callTool('echo', { message: 'hello' })).toEqual({
        content: [{ type: 'text', text: 'hello' }],
      });
      expect(requests.every((req) => req.authorization === 'Bearer protocol-test-token')).toBe(
        true,
      );
      expect(requests[0].body.method).toBe('server/discover');
      const initialized = requests.some((req) => req.body.method === 'initialize');
      expect(initialized).toBe(version === '2025-11-25');
      const call = requests.find((req) => req.body.method === 'tools/call')!.body;
      if (version === '2026-07-28') {
        expect(call.params._meta['io.modelcontextprotocol/protocolVersion']).toBe(version);
      }
    } finally {
      await client.disconnect();
    }
  });
});
