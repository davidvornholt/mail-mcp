import { afterEach, expect, it } from 'bun:test';
import { closeClient, connectClient } from './server-test-client';

const subprocessTimeoutMs = 30_000;

afterEach(async () => {
  await closeClient();
});

it(
  'rejects invalid search scope and folder combinations before connecting',
  async () => {
    const client = await connectClient();
    const calls = [
      {
        name: 'search_mail',
        arguments: {
          account: 'test@example.com',
          scope: 'all',
          folder: 'INBOX',
        },
      },
      {
        name: 'search_mail',
        arguments: { account: 'test@example.com', scope: 'folder' },
      },
      {
        name: 'search_mail',
        arguments: { account: 'test@example.com', folder: 'INBOX' },
      },
    ] as const;

    const results = await Promise.all(
      calls.map((request) => client.callTool(request)),
    );
    expect(results.every(({ isError }) => isError === true)).toBe(true);
    const messages = results.map(({ content }) => JSON.stringify(content));
    expect(messages[0]).toContain('Do not pass folder');
    expect(messages[1]).toContain('requires a folder');
    expect(messages[2]).toContain('Do not pass folder');
  },
  subprocessTimeoutMs,
);
