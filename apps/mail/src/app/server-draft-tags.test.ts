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
      required: ['drafts', 'tagKey'],
      properties: {
        drafts: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['account', 'folder', 'uid', 'uidValidity'],
            properties: {
              account: { type: 'string' },
              folder: { type: 'string' },
              uid: { type: 'integer', exclusiveMinimum: 0 },
              uidValidity: { type: 'string' },
            },
          },
        },
        tagKey: { type: 'string', pattern: expect.any(String) },
      },
    });
  },
  subprocessTimeoutMs,
);

it.each(['campaign+eu', 'campaign/eu', 'launch=20+=20europe'])(
  'accepts the valid Thunderbird custom tag key %s',
  async (tagKey) => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'tag_drafts',
      arguments: {
        drafts: [
          {
            account: 'unknown@example.com',
            folder: 'Drafts',
            uid: 1,
            uidValidity: '111',
          },
        ],
        tagKey,
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
