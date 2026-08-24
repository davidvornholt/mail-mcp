// biome-ignore lint/correctness/noUnresolvedImports: Biome does not follow the MCP SDK's package.json exports map; tsc and Bun resolve this import correctly.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Effect } from 'effect';
import { Imap } from '../features/mail/services/imap';
import { draftTagAnnotations, tagDraftsFields } from './mcp-contract';
import { runTool } from './mcp-runtime';

export const registerDraftTagTool = (
  server: McpServer,
  accounts: string,
): void => {
  server.registerTool(
    'tag_drafts',
    {
      description: `Add one Thunderbird tag key or IMAP keyword to existing drafts. Pass each draft's uid and uidValidity handles from search_mail together; the operation checks that the mailbox was not reindexed, every UID exists, and every requested draft has the tag before reporting success. It refuses messages outside the account's Drafts folder. Built-in Thunderbird keys are $label1 through $label5; custom keywords appear by name only when Thunderbird has a matching custom tag. Accounts: ${accounts}`,
      inputSchema: tagDraftsFields,
      annotations: draftTagAnnotations,
    },
    ({ account, folder, drafts, tagKey }) =>
      runTool(
        Effect.gen(function* () {
          const imap = yield* Imap;
          return yield* imap.tagDrafts({
            account,
            folder,
            drafts,
            tagKey,
          });
        }),
      ),
  );
};
