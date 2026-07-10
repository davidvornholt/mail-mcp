export type FolderInfo = {
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly subscribed: boolean;
};

export type SearchOptions = {
  readonly folder: string;
  readonly limit: number;
  readonly query?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly since?: string;
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
  readonly references: ReadonlyArray<string>;
  readonly text: string;
  readonly html: string | null;
};

export type DraftInput = {
  readonly account: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly inReplyTo?: string;
  readonly references?: ReadonlyArray<string>;
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
