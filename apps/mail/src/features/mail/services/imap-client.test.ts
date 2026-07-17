import { describe, expect, it } from 'bun:test';
import { Effect, Fiber } from 'effect';
import type { ImapFlow } from 'imapflow';
import type { Account } from '../schemas/account';
import { connectClient, makeClient } from './imap-client';

const account: Account = {
  email: 'me@example.com',
  name: 'Me',
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'me@example.com',
};

type ImapFlowWithErrorEmitter = ImapFlow & {
  emitError: (error: Error & { code?: string }) => void;
};

describe('makeClient', () => {
  it('closes every constructed client when ImapFlow emits a socket timeout', () => {
    const client = makeClient(account, 'password');
    client.usable = true;
    const timeout = Object.assign(new Error('Socket timeout'), {
      code: 'ETIMEOUT',
    });

    expect(() =>
      (client as ImapFlowWithErrorEmitter).emitError(timeout),
    ).not.toThrow();
    expect(client.usable).toBeFalse();
    expect(makeClient(account, 'password')).not.toBe(client);
  });

  it('closes a constructed candidate when connection fails', async () => {
    const client = makeClient(account, 'password');
    let closeCalls = 0;
    client.connect = () => Promise.reject(new Error('connect failed'));
    client.close = () => {
      closeCalls += 1;
    };

    const error = await Effect.runPromise(
      Effect.flip(connectClient(client, account.host)),
    );

    expect(error).toMatchObject({ _tag: 'ImapError' });
    expect(closeCalls).toBe(1);
  });

  it('closes a constructed candidate when connection is interrupted', async () => {
    const client = makeClient(account, 'password');
    let closeCalls = 0;
    client.connect = () => new Promise<void>(() => undefined);
    client.close = () => {
      closeCalls += 1;
    };
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(connectClient(client, account.host));
      yield* Effect.yieldNow();
      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program);

    expect(closeCalls).toBe(1);
  });
});
