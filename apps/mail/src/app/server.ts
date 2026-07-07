import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Effect, ManagedRuntime } from 'effect';
import { z } from 'zod';
import type { MailError } from '../features/mail/errors/errors';
import { accountEmails } from '../features/mail/schemas/account';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { Imap } from '../features/mail/services/imap';

// One managed runtime for the process keeps IMAP connections warm across tool
// calls; the Imap layer's finalizer closes them if the runtime is disposed.
const runtime = ManagedRuntime.make(Imap.Default);
const accountList = accountEmails.join(', ');

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

const runTool = <A>(program: Effect.Effect<A, MailError, Imap>) =>
  runtime.runPromise(
    program.pipe(
      Effect.map((value) => textResult(JSON.stringify(value, null, 2))),
      Effect.catchAll((error) =>
        Effect.succeed(textResult(`Error: ${error.message}`, true)),
      ),
    ),
  );

const server = new McpServer({ name: 'mail-mcp', version: '0.0.0' });

server.tool(
  'list_accounts',
  'List the configured email accounts you can act on.',
  {},
  () => Promise.resolve(textResult(JSON.stringify(accountEmails, null, 2))),
);

server.tool(
  'list_folders',
  `List IMAP folders for an account. Accounts: ${accountList}`,
  { account: z.string() },
  ({ account }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        return yield* imap.listFolders(account);
      }),
    ),
);

server.tool(
  'search_mail',
  `Search a mailbox: 'query' matches subject/body/from/to text, or narrow with 'from'/'subject'/'since' (ISO date). Returns folder+uid handles for read_message. Accounts: ${accountList}`,
  {
    account: z.string(),
    query: z.string().optional(),
    folder: z.string().optional(),
    from: z.string().optional(),
    subject: z.string().optional(),
    since: z.string().optional(),
    limit: z.number().optional(),
  },
  ({ account, query, folder, from, subject, since, limit }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        return yield* imap.search(account, {
          folder: folder ?? 'INBOX',
          query,
          from,
          subject,
          since,
          limit: limit ?? defaultSearchLimit,
        });
      }),
    ),
);

server.tool(
  'read_message',
  `Read one full message by folder + uid (from search_mail). Accounts: ${accountList}`,
  { account: z.string(), folder: z.string(), uid: z.number() },
  ({ account, folder, uid }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        return yield* imap.read(account, folder, uid);
      }),
    ),
);

server.tool(
  'save_draft',
  `Compose an email/reply and SAVE IT AS A DRAFT (does NOT send; the user reviews and sends from Thunderbird). For replies pass inReplyTo + references to keep threading. Accounts: ${accountList}`,
  {
    account: z.string(),
    to: z.string(),
    cc: z.string().optional(),
    bcc: z.string().optional(),
    subject: z.string(),
    text: z.string(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
  },
  ({ account, to, cc, bcc, subject, text, inReplyTo, references }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        const folder = yield* imap.saveDraft({
          account,
          to,
          cc,
          bcc,
          subject,
          text,
          inReplyTo,
          references,
        });
        return {
          savedTo: folder,
          account,
          note: 'Draft saved. Review and send it in Thunderbird.',
        };
      }),
    ),
);

await server.connect(new StdioServerTransport());
