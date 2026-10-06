import type WebSocket from 'isomorphic-ws';
import { parse } from 'graphql';
import { buildWSLegacyExecutor, LegacyWSExecutorOpts } from '@graphql-tools/executor-legacy-ws';
import { isAsyncIterable } from '@graphql-tools/utils';

interface CapturedConnection {
  url: string;
  protocol?: string | string[];
  options?: Record<string, any>;
}

/**
 * A WebSocket implementation that records the options passed to its constructor,
 * so we can assert which TLS settings the executor uses to open the connection.
 */
function createCapturingWebSocketImpl() {
  const connections: CapturedConnection[] = [];
  class CapturingWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    constructor(url: string, protocol?: string | string[], options?: Record<string, any>) {
      connections.push({ url, protocol, options });
    }

    send() {}
    terminate() {}
  }
  return {
    WebSocketImpl: CapturingWebSocket as unknown as typeof WebSocket,
    connections,
  };
}

async function openSubscription(endpoint: string, options?: LegacyWSExecutorOpts) {
  const { WebSocketImpl, connections } = createCapturingWebSocketImpl();
  const executor = buildWSLegacyExecutor(endpoint, WebSocketImpl, options);
  const result = await executor({
    document: parse(/* GraphQL */ `
      subscription {
        count
      }
    `),
  });
  if (!isAsyncIterable(result)) {
    throw new Error('Expected an async iterable result');
  }
  await result[Symbol.asyncIterator]().return?.();
  expect(connections).toHaveLength(1);
  return connections[0];
}

describe('Legacy WS Executor', () => {
  describe('TLS certificate validation', () => {
    it('should reject unauthorized TLS certificates by default', async () => {
      const connection = await openSubscription('wss://untrusted.example.com/graphql');
      expect(connection.url).toBe('wss://untrusted.example.com/graphql');
      expect(connection.protocol).toBe('graphql-ws');
      expect(connection.options?.['rejectUnauthorized']).toBe(true);
    });

    it('should reject unauthorized TLS certificates by default when credentials are sent', async () => {
      const connection = await openSubscription('wss://untrusted.example.com/graphql', {
        headers: {
          authorization: 'Bearer secret-token',
        },
        connectionParams: {
          authToken: 'secret-token',
        },
      });
      expect(connection.options?.['headers']).toEqual({
        authorization: 'Bearer secret-token',
      });
      expect(connection.options?.['rejectUnauthorized']).toBe(true);
    });

    it('should reject unauthorized TLS certificates when explicitly enabled', async () => {
      const connection = await openSubscription('wss://untrusted.example.com/graphql', {
        rejectUnauthorized: true,
      });
      expect(connection.options?.['rejectUnauthorized']).toBe(true);
    });

    it('should allow opting out of TLS certificate validation', async () => {
      const connection = await openSubscription('wss://localhost/graphql', {
        rejectUnauthorized: false,
      });
      expect(connection.options?.['rejectUnauthorized']).toBe(false);
    });
  });
});
