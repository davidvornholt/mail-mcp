import { describe, expect, it } from 'bun:test';
import type { ImapFlow } from 'imapflow';
import type { Account } from '../schemas/account';
import { makeClient } from './imap-client';

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
});
