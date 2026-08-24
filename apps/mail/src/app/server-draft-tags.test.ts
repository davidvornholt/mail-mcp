import { afterEach, expect, it } from 'bun:test';
import { closeClient, connectClient } from './server-test-client';

const subprocessTimeoutMs = 30_000;

afterEach(async () => {
  await closeClient();
});

it(
  'advertises the batch draft tag schema',
  async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    expect(
      tools.find((tool) => tool.name === 'tag_drafts')?.inputSchema,
    ).toMatchObject({
      required: ['account', 'folder', 'uids', 'uidValidity', 'tagKey'],
      properties: {
        uids: {
          type: 'array',
          minItems: 1,
          items: { type: 'integer', exclusiveMinimum: 0 },
        },
        uidValidity: { type: 'string' },
        tagKey: { type: 'string', pattern: expect.any(String) },
      },
    });
  },
  subprocessTimeoutMs,
);

it(
  'accepts Thunderbird custom tag keys containing equals signs',
  async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'tag_drafts',
      arguments: {
        account: 'unknown@example.com',
        folder: 'Drafts',
        uids: [1],
        uidValidity: '111',
        tagKey: 'welle=201',
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Unknown account');
    expect(JSON.stringify(result.content)).not.toContain(
      'Input validation error',
    );
  },
  subprocessTimeoutMs,
);
