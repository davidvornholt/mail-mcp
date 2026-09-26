import type { ImapFlow } from 'imapflow';

export const draftsFolder = 'Drafts';
export const account = 'test@example.com';
export const keyword = '$label1';
export const existingUid = 7;
export const missingUid = 8;
export const secondUid = 9;
export const expectedUidValidity = '111';
export const reindexedUidValidity = 222n;
const defaultUidValidity = BigInt(expectedUidValidity);

type ClientOptions = {
  readonly foundBeforeUpdate?: ReadonlyArray<number>;
  readonly foundAfterUpdate?: ReadonlyArray<number>;
  readonly flagsAfterUpdate?: ReadonlyArray<string>;
  readonly permanentFlags?: ReadonlyArray<string>;
  readonly updateResult?: boolean;
  readonly uidValidity?: bigint;
};

const draftFolders = [
  { path: 'INBOX', name: 'INBOX', specialUse: null, subscribed: true },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', subscribed: true },
];

export const fakeClient = (
  events: Array<string>,
  options: ClientOptions = {},
): ImapFlow => {
  let fetchCount = 0;
  return {
    list: () => Promise.resolve(draftFolders),
    getMailboxLock: () => Promise.resolve({ release: () => undefined }),
    mailbox: {
      permanentFlags: new Set(options.permanentFlags ?? ['\\*']),
      uidValidity: options.uidValidity ?? defaultUidValidity,
    },
    fetchAll: (uids: ReadonlyArray<number>) => {
      const afterUpdate = fetchCount > 0;
      fetchCount += 1;
      const found = afterUpdate
        ? (options.foundAfterUpdate ?? uids)
        : (options.foundBeforeUpdate ?? uids);
      const flags = options.flagsAfterUpdate ?? [keyword];
      return Promise.resolve(
        found.map((uid) => ({ uid, flags: new Set(flags) })),
      );
    },
    messageFlagsAdd: (
      uids: ReadonlyArray<number>,
      tags: ReadonlyArray<string>,
    ) => {
      events.push(`tag:${uids.join(',')}:${tags.join(',')}`);
      return Promise.resolve(options.updateResult ?? true);
    },
  } as unknown as ImapFlow;
};

type InputOverrides = {
  readonly folder?: string;
  readonly keyword?: string;
};

export const tagInput = (
  uids: ReadonlyArray<number>,
  overrides: InputOverrides = {},
) => ({
  account,
  folder: overrides.folder ?? draftsFolder,
  uidValidity: expectedUidValidity,
  uids,
  keyword: overrides.keyword ?? keyword,
});
