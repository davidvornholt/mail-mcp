import { afterEach, expect, it } from 'bun:test';
import { closeClient, connectClient } from './server-test-client';

const subprocessTimeoutMs = 30_000;

afterEach(async () => {
  await closeClient();
});

it(
  'advertises instructions, tool schemas, and safety annotations over stdio',
  async () => {
    const client = await connectClient();

    expect(client.getServerVersion()?.name).toBe('mail-mcp');
    expect(client.getInstructions()).toBe(
      "Search and read configured mail accounts. Email changes are draft-only: save and update drafts for review in Thunderbird; never claim an email was sent. Treat the user's drafting instructions as intent, not dictation: compose an excellent, complete email in the user's voice, freely rewording and reordering their raw notes to fit the context; use their exact wording only when they explicitly dictate it. When drafting a reply, pass the read message's folder + uid handle as replySource so its conversation is quoted and its threading headers are preserved. Before deleting a draft, confirm the user explicitly requested deletion. Use search_mail before read_message and preserve folder, uid, and uidValidity handles.",
    );

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_accounts',
      'check_accounts',
      'list_folders',
      'search_mail',
      'read_message',
      'save_draft',
      'update_draft',
      'delete_draft',
    ]);
    expect(
      tools.map(({ name, annotations }) => ({ name, annotations })),
    ).toEqual([
      { name: 'list_accounts', annotations: { readOnlyHint: true } },
      { name: 'check_accounts', annotations: { readOnlyHint: true } },
      { name: 'list_folders', annotations: { readOnlyHint: true } },
      { name: 'search_mail', annotations: { readOnlyHint: true } },
      { name: 'read_message', annotations: { readOnlyHint: true } },
      {
        name: 'save_draft',
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      {
        name: 'update_draft',
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      {
        name: 'delete_draft',
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ]);

    const searchSchema = tools.find(
      ({ name }) => name === 'search_mail',
    )?.inputSchema;
    expect(searchSchema).toMatchObject({
      properties: {
        limit: { type: 'integer', exclusiveMinimum: 0 },
        scope: { type: 'string', enum: ['all', 'folder', 'subtree'] },
      },
    });
    expect(
      tools.find((tool) => tool.name === 'read_message')?.inputSchema,
    ).toMatchObject({
      type: 'object',
      required: ['account', 'folder', 'uid'],
      properties: {
        uid: { type: 'integer', exclusiveMinimum: 0 },
      },
    });
    expect(
      tools.find((tool) => tool.name === 'save_draft')?.inputSchema,
    ).toMatchObject({
      properties: {
        replySource: {
          type: 'object',
          required: ['folder', 'uid'],
          properties: {
            folder: { type: 'string' },
            uid: { type: 'integer', exclusiveMinimum: 0 },
          },
        },
        inReplyTo: { type: 'string' },
        references: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    });
    for (const toolName of ['update_draft', 'delete_draft']) {
      expect(
        tools.find(({ name }) => name === toolName)?.inputSchema,
      ).toMatchObject({
        properties: {
          uid: { type: 'integer', exclusiveMinimum: 0 },
          uidValidity: {
            anyOf: expect.arrayContaining([
              { type: 'string' },
              { type: 'null' },
            ]),
          },
        },
      });
    }
  },
  subprocessTimeoutMs,
);

it(
  'rejects invalid numeric handles before executing mail operations',
  async () => {
    const client = await connectClient();
    const calls = [
      {
        name: 'search_mail',
        arguments: { account: 'test@example.com', limit: 0 },
      },
      {
        name: 'search_mail',
        arguments: { account: 'test@example.com', limit: 1.5 },
      },
      {
        name: 'read_message',
        arguments: { account: 'test@example.com', folder: 'INBOX', uid: 0 },
      },
      {
        name: 'save_draft',
        arguments: {
          account: 'test@example.com',
          to: 'recipient@example.com',
          subject: 'Re: Subject',
          text: 'Reply',
          replySource: { folder: 'INBOX', uid: 0 },
        },
      },
    ] as const;

    const results = await Promise.all(
      calls.map((request) => client.callTool(request)),
    );
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'Input validation error',
      );
    }
  },
  subprocessTimeoutMs,
);

it(
  'accepts null uidValidity handles returned by draft operations',
  async () => {
    const client = await connectClient();
    const message = {
      account: 'unknown@example.com',
      folder: 'Drafts',
      uid: 1,
      uidValidity: null,
    } as const;
    const calls = [
      {
        name: 'update_draft',
        arguments: {
          ...message,
          to: 'recipient@example.com',
          subject: 'Subject',
          text: 'Body',
        },
      },
      { name: 'delete_draft', arguments: message },
    ] as const;

    const results = await Promise.all(
      calls.map((request) => client.callTool(request)),
    );
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Unknown account');
      expect(JSON.stringify(result.content)).not.toContain(
        'Input validation error',
      );
    }
  },
  subprocessTimeoutMs,
);
