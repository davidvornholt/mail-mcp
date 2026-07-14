import { z } from 'zod';
import { searchScopes } from '../features/mail/schemas/mail';

export const serverInstructions =
  "Search and read configured mail accounts. Email changes are draft-only: save and update drafts for review in Thunderbird; never claim an email was sent. Treat the user's drafting instructions as intent, not dictation: compose an excellent, complete email in the user's voice, freely rewording and reordering their raw notes to fit the context; use their exact wording only when they explicitly dictate it. When drafting a reply, pass the read message's folder + uid handle as replySource so its conversation is quoted and its threading headers are preserved. Before deleting a draft, confirm the user explicitly requested deletion. Use search_mail before read_message and preserve folder, uid, and uidValidity handles.";

export const searchMailDescription = (accounts: string): string =>
  `Search mail globally by default, one exact folder with scope='folder', or a folder plus descendants with scope='subtree'. Folder-based searches require an explicit scope. Global search prefers the server's all-mail mailbox; its fallback includes Inbox, Archive, Sent, and custom mail folders while excluding Drafts, Junk, Trash, and duplicate virtual folders. 'query' matches subject/body/from/to text; narrow with 'from'/'subject'/'since' (ISO date). Results are globally newest-first and return folder+uid handles for read_message. Accounts: ${accounts}`;

export const readOnlyAnnotations = { readOnlyHint: true } as const;
export const draftWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
} as const;
export const draftReplacementAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
} as const;
export const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
} as const;

const attachmentSchema = z.object({
  path: z.string(),
  filename: z.string().optional(),
  contentType: z.string().optional(),
  cid: z.string().optional(),
});

const messageHandleSchema = z.object({
  folder: z.string(),
  uid: z.number().int().positive(),
});

export const messageFields = {
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
  replySource: messageHandleSchema.optional(),
} as const;

export const checkAccountsFields = {
  account: z.string().optional(),
  quick: z.boolean().optional(),
} as const;
export const accountFields = { account: z.string() } as const;
export const searchMailFields = {
  account: z.string(),
  query: z.string().optional(),
  scope: z
    .enum(searchScopes)
    .optional()
    .describe(
      'Defaults to all; use folder for exact or subtree for recursive.',
    ),
  folder: z
    .string()
    .optional()
    .describe('Required when scope is folder or subtree; invalid otherwise.'),
  from: z.string().optional(),
  subject: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().optional(),
} as const;
export const readMessageFields = {
  account: z.string(),
  folder: z.string(),
  uid: z.number().int().positive(),
} as const;

const draftLocationFields = {
  folder: z.string(),
  uid: z.number().int().positive(),
  uidValidity: z.string().nullable().optional(),
} as const;

export const updateDraftFields = {
  ...messageFields,
  ...draftLocationFields,
} as const;
export const deleteDraftFields = {
  account: z.string(),
  ...draftLocationFields,
} as const;

export const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});
