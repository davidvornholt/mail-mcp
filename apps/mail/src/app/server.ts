import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { MailConfig } from '../features/mail/services/config';
import { Imap } from '../features/mail/services/imap';
import { resolveSearchOptions } from '../features/mail/services/search-options';
import { Secrets } from '../features/mail/services/secrets';
import { checkAccounts } from '../features/mail/services/status';
import {
  accountFields,
  checkAccountsFields,
  deleteDraftFields,
  destructiveAnnotations,
  draftReplacementAnnotations,
  draftWriteAnnotations,
  messageFields,
  readMessageFields,
  readOnlyAnnotations,
  searchMailDescription,
  searchMailFields,
  serverInstructions,
  textResult,
  updateDraftFields,
} from './mcp-contract';

type ToolEnv = Imap | Secrets | MailConfig;

// Keep IMAP connections warm; the Imap layer finalizer closes them on disposal.
const runtime = ManagedRuntime.make(
  Layer.mergeAll(MailConfig.Default, Secrets.Default, Imap.Default),
);

const accountEmails = await runtime.runPromise(
  Effect.map(MailConfig, (config) => config.emails),
);
const accountList = accountEmails.join(', ');

const runTool = <A>(program: Effect.Effect<A, MailError, ToolEnv>) =>
  runtime.runPromise(
    program.pipe(
      Effect.map((value) => textResult(JSON.stringify(value, null, 2))),
      Effect.catchAll((error) =>
        Effect.succeed(textResult(`Error: ${error.message}`, true)),
      ),
    ),
  );

const server = new McpServer(
  { name: 'mail-mcp', version: '0.0.0' },
  { instructions: serverInstructions },
);

server.registerTool(
  'list_accounts',
  {
    description: 'List the configured email accounts you can act on.',
    inputSchema: {},
    annotations: readOnlyAnnotations,
  },
  () => Promise.resolve(textResult(JSON.stringify(accountEmails, null, 2))),
);

server.registerTool(
  'check_accounts',
  {
    description: `Report each account's auth state: 'authenticated' (works), 'no-password' (needs 'mail login'), or 'unauthenticated' (wrong password or IMAP config). Pass an account to check one, or quick=true for a keyring-only check that skips connecting. Accounts: ${accountList}`,
    inputSchema: checkAccountsFields,
    annotations: readOnlyAnnotations,
  },
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

server.registerTool(
  'list_folders',
  {
    description: `List IMAP folders for an account. Accounts: ${accountList}`,
    inputSchema: accountFields,
    annotations: readOnlyAnnotations,
  },
  ({ account }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        return yield* imap.listFolders(account);
      }),
    ),
);

server.registerTool(
  'search_mail',
  {
    description: searchMailDescription(accountList),
    inputSchema: searchMailFields,
    annotations: readOnlyAnnotations,
  },
  ({ account, query, scope, folder, from, subject, since, limit }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        const options = yield* resolveSearchOptions({
          scope,
          folder,
          query,
          from,
          subject,
          since,
          limit: limit ?? defaultSearchLimit,
        });
        return yield* imap.search(account, options);
      }),
    ),
);

server.registerTool(
  'read_message',
  {
    description: `Read one full message by folder + uid (from search_mail). Accounts: ${accountList}`,
    inputSchema: readMessageFields,
    annotations: readOnlyAnnotations,
  },
  ({ account, folder, uid }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        return yield* imap.read(account, folder, uid);
      }),
    ),
);

server.registerTool(
  'save_draft',
  {
    description: `Compose an email/reply and SAVE IT AS A DRAFT (does NOT send; the user reviews and sends from Thunderbird). The user's instructions are intent, not dictation: write an excellent, complete email in their voice, freely rewording and reordering their raw notes to fit the context; copy their exact wording only when they explicitly dictate it. An HTML alternative is generated from 'text' automatically; pass 'html' only for custom markup. For replies pass replySource with the folder + uid from read_message; the original conversation is quoted in the body and its threading headers are preserved automatically. replySource-derived headers take precedence over manual inReplyTo + references. Accounts: ${accountList}`,
    inputSchema: messageFields,
    annotations: draftWriteAnnotations,
  },
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

server.registerTool(
  'update_draft',
  {
    description: `Replace an existing draft identified by its drafts folder + uid. Compose the replacement to the same standard as save_draft: the user's instructions are intent, not dictation. The replacement is saved before the old draft is deleted. Messages outside the account's Drafts folder are refused. Pass the uidValidity from the draft's save response so a mailbox reindex cannot expunge the wrong message. Accounts: ${accountList}`,
    inputSchema: updateDraftFields,
    annotations: draftReplacementAnnotations,
  },
  ({ uidValidity, ...input }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        const location = yield* imap.updateDraft({
          ...input,
          uidValidity: uidValidity ?? undefined,
        });
        return { ...location, account: input.account };
      }),
    ),
);

server.registerTool(
  'delete_draft',
  {
    description: `Permanently delete a draft identified by its drafts folder + uid. Messages outside the account's Drafts folder are refused. Pass the uidValidity from the draft's save response so a mailbox reindex cannot expunge the wrong message. Accounts: ${accountList}`,
    inputSchema: deleteDraftFields,
    annotations: destructiveAnnotations,
  },
  ({ account, folder, uid, uidValidity }) =>
    runTool(
      Effect.gen(function* () {
        const imap = yield* Imap;
        yield* imap.deleteDraft(account, folder, uid, uidValidity ?? undefined);
        return { account, folder, uid, deleted: true };
      }),
    ),
);

await server.connect(new StdioServerTransport());
