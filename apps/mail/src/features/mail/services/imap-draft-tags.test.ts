import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import {
  existingUid,
  handle,
  secondUid,
  tagKey,
} from './draft-tags.test-support';
import { tagAccountDrafts } from './imap';

const otherAccount = 'other@example.com';
const otherFolder = 'Archive/Drafts';

describe('tagAccountDrafts source validation', () => {
  it.each([
    [
      'accounts',
      [handle(existingUid), handle(secondUid, { account: otherAccount })],
      'mixed account handles',
    ],
    [
      'folders',
      [handle(existingUid), handle(secondUid, { folder: otherFolder })],
      'mixed folder handles',
    ],
    [
      'mailbox generations',
      [handle(existingUid), handle(secondUid, { uidValidity: '222' })],
      'mixed uidValidity handles',
    ],
  ] as const)(
    'rejects mixed %s before acquiring an IMAP client',
    async (_source, drafts, expectedMessage) => {
      const acquiredAccounts: Array<string> = [];
      const error = await Effect.runPromise(
        Effect.flip(
          tagAccountDrafts(
            (selectedAccount) => {
              acquiredAccounts.push(selectedAccount);
              return Effect.succeed({} as ImapFlow);
            },
            { drafts, tagKey },
          ),
        ),
      );

      expect(error._tag).toBe('DraftError');
      expect(error.message).toContain(expectedMessage);
      expect(acquiredAccounts).toEqual([]);
    },
  );
});
