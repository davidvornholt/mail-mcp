import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { z } from 'zod';
import type { MailError } from '../features/mail/errors/errors';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { MailConfig } from '../features/mail/services/config';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';
import { checkAccounts } from '../features/mail/services/status';

type ToolEnv = Imap | Secrets | MailConfig;

// One managed runtime for the process keeps IMAP connections warm across tool
// calls; the Imap layer's finalizer closes them if the runtime is disposed.
// MailConfig and Secrets are merged in for the account list and status checks.
const runtime = ManagedRuntime.make(
  Layer.mergeAll(MailConfig.Default, Secrets.Default, Imap.Default),
);

// Load the account list once at startup; a config-load failure rejects here and
// exits the server with the ConfigError message on stderr.
const accountEmails = await runtime.runPromise(
  Effect.map(MailConfig, (config) => config.emails),
);
const accountList = accountEmails.join(', ');

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

const runTool = <A>(program: Effect.Effect<A, MailError, ToolEnv>) =>
  runtime.runPromise(
    program.pipe(
      Effect.map((value) => textResult(JSON.stringify(value, null, 2))),
      Effect.catchAll((error) =>
        Effect.succeed(textResult(`Error: ${error.message}`, true)),
      ),
    ),
  );

const server = new McpServer({ name: 'mail-mcp', version: '0.0.0' });

const attachmentSchema = z.object({
  path: z.string(),
  filename: z.string().optional(),
  contentType: z.string().optional(),
  cid: z.string().optional(),
});

const messageFields = {
  account: z.string(),
  to: z.string(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
} as const;

server.tool(
  'list_accounts',
  'List the configured email accounts you can act on.',
  {},
  () => Promise.resolve(textResult(JSON.stringify(accountEmails, null, 2))),
);

server.tool(
  'check_accounts',
  `Report each account's auth state: 'authenticated' (works), 'no-password' (needs 'mail login'), or 'unauthenticated' (wrong password or IMAP config). Pass an account to check one, or quick=true for a keyring-only check that skips connecting. Accounts: ${accountList}`,
  { account: z.string().optional(), quick: z.boolean().optional() },
  ({ account, quick }) =>
    runTool(
      Effect.gen(function* () {
        const config = yield* MailConfig;
        const emails =
          account === undefined
            ? config.emails
            : [(yield* config.getAccount(account)).email];
        return yield* checkAccounts(emails, { verify: quick !== true });
      }),
    ),
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
  messageFields,
  (input) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        const location = yield* imap.saveDraft(input);
        return {
          ...location,
          account: input.account,
          note: 'Draft saved. Review and send it in Thunderbird.',
        };
      }),
    ),
);

server.tool(
  'update_draft',
  `Replace an existing draft identified by its drafts folder + uid. The replacement is saved before the old draft is deleted. Messages outside the account's Drafts folder are refused. Pass the uidValidity from the draft's save response so a mailbox reindex cannot expunge the wrong message. Accounts: ${accountList}`,
  {
    ...messageFields,
    folder: z.string(),
    uid: z.number().int().positive(),
    uidValidity: z.string().optional(),
  },
  (input) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        const location = yield* imap.updateDraft(input);
        return { ...location, account: input.account };
      }),
    ),
);

server.tool(
  'delete_draft',
  `Permanently delete a draft identified by its drafts folder + uid. Messages outside the account's Drafts folder are refused. Pass the uidValidity from the draft's save response so a mailbox reindex cannot expunge the wrong message. Accounts: ${accountList}`,
  {
    account: z.string(),
    folder: z.string(),
    uid: z.number().int().positive(),
    uidValidity: z.string().optional(),
  },
  ({ account, folder, uid, uidValidity }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        yield* imap.deleteDraft(account, folder, uid, uidValidity);
        return { account, folder, uid, deleted: true };
      }),
    ),
);

await server.connect(new StdioServerTransport());
