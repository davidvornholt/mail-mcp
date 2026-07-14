export type FolderInfo = {
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly subscribed: boolean;
};

export const searchScopes = ['all', 'folder', 'subtree'] as const;

export type SearchScope = (typeof searchScopes)[number];

type SearchCriteria = {
  readonly limit: number;
  readonly query?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly since?: string;
};

export type SearchLocation =
  | { readonly scope: 'all' }
  | { readonly scope: 'folder' | 'subtree'; readonly folder: string };

export type SearchOptions = SearchCriteria & SearchLocation;

export type SearchOptionsInput = SearchCriteria & {
  readonly scope?: SearchScope;
  readonly folder?: string;
};

export type SearchHit = {
  readonly uid: number;
  readonly folder: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly date: string;
};

export type FullMessage = {
  readonly uid: number;
  readonly folder: string;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly subject: string;
  readonly date: string;
  readonly messageId: string;
  readonly inReplyTo: string;
  readonly references: ReadonlyArray<string>;
  readonly text: string;
  readonly html: string | null;
  readonly attachments: ReadonlyArray<MessageAttachment>;
};

export type MessageAttachment = {
  readonly part: string;
  readonly filename: string | null;
  readonly contentType: string;
  readonly size: number | null;
  readonly disposition: string | null;
  readonly contentId: string | null;
};

export type AttachmentContent = MessageAttachment & {
  readonly content: Uint8Array;
};

export type MessageHandle = {
  readonly folder: string;
  readonly uid: number;
};

export type DraftInput = {
  readonly account: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly attachments?: ReadonlyArray<MailAttachment>;
  readonly cc?: string;
  readonly bcc?: string;
  readonly inReplyTo?: string;
  readonly references?: ReadonlyArray<string>;
  readonly replySource?: MessageHandle;
};

export type MailAttachment = {
  readonly path: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly cid?: string;
};

export type DraftLocation = {
  readonly folder: string;
  readonly uid: number | null;
  // UIDVALIDITY of the folder when the uid was minted, serialized (it is a
  // bigint). Null when the server lacks UIDPLUS. Round-trip it back on
  // update/delete so a mailbox reindex cannot expunge the wrong message.
  readonly uidValidity: string | null;
};

export type UpdateDraftInput = DraftInput & {
  readonly folder: string;
  readonly uid: number;
  readonly uidValidity?: string;
};

export const defaultSearchLimit = 20;

export type AccountStatusState =
  | 'authenticated'
  | 'password-stored'
  | 'no-password'
  | 'unauthenticated'
  | 'error';

export type AccountStatus = {
  readonly email: string;
  readonly ok: boolean;
  readonly state: AccountStatusState;
  readonly message: string;
};
