import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { tagDrafts } from './draft-tags';
import {
  account,
  draftsFolder,
  existingUid,
  expectedUidValidity,
  fakeClient,
  keyword,
  missingUid,
  reindexedUidValidity,
  secondUid,
  tagInput,
} from './draft-tags.test-support';

describe('tagDrafts validation', () => {
  it('validates and tags all unique draft uids in one update', async () => {
    const events: Array<string> = [];
    const result = await Effect.runPromise(
      tagDrafts(
        fakeClient(events),
        tagInput([existingUid, secondUid, existingUid]),
      ),
    );

    expect(events).toEqual([`tag:${existingUid},${secondUid}:${keyword}`]);
    expect(result).toEqual({
      account,
      folder: draftsFolder,
      uidValidity: expectedUidValidity,
      uids: [existingUid, secondUid],
      keyword,
    });
  });

  it('requires at least one uid', async () => {
    const error = await Effect.runPromise(
      Effect.flip(tagDrafts(fakeClient([]), tagInput([]))),
    );

    expect(error._tag).toBe('DraftError');
  });

  it('reports every missing uid before changing flags', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { foundBeforeUpdate: [existingUid] }),
          tagInput([existingUid, missingUid, secondUid]),
        ),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain(`uids ${missingUid}, ${secondUid}`);
    expect(events).toEqual([]);
  });

  it('refuses a keyword the server does not persist', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { permanentFlags: ['\\Seen', '$label2'] }),
          tagInput([existingUid]),
        ),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain('does not allow keyword');
    expect(events).toEqual([]);
  });

  it('uses the case-insensitive spelling advertised by the server', async () => {
    const events: Array<string> = [];
    const result = await Effect.runPromise(
      tagDrafts(
        fakeClient(events, { permanentFlags: ['$LABEL1'] }),
        tagInput([existingUid]),
      ),
    );

    expect(events).toEqual([`tag:${existingUid}:$LABEL1`]);
    expect(result.keyword).toBe('$LABEL1');
  });
});

describe('tagDrafts keyword safety', () => {
  it.each([
    ['$SubmitPending', 'submission keywords'],
    ['$submitted', 'submission keywords'],
    ['\\Seen', 'system flag'],
    ['two words', 'not a valid IMAP keyword'],
    ['brace{', 'not a valid IMAP keyword'],
    ['', 'not a valid IMAP keyword'],
  ] as const)('rejects %p before connecting', async (unsafe, expected) => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events),
          tagInput([existingUid], { keyword: unsafe }),
        ),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain(expected);
    expect(events).toEqual([]);
  });

  it('accepts client label keywords such as welle=201', async () => {
    const events: Array<string> = [];
    await Effect.runPromise(
      tagDrafts(
        fakeClient(events, { flagsAfterUpdate: ['welle=201'] }),
        tagInput([existingUid], { keyword: 'welle=201' }),
      ),
    );

    expect(events).toEqual([`tag:${existingUid}:welle=201`]);
  });
});

describe('tagDrafts completion', () => {
  it('reports when the server rejects the flag update', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient([], { updateResult: false }),
          tagInput([existingUid]),
        ),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain('server rejected the update');
  });

  it('refuses messages outside the drafts folder', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([]), tagInput([existingUid], { folder: 'INBOX' })),
      ),
    );

    expect(error._tag).toBe('DraftError');
  });

  it('refuses every update when the drafts mailbox was reindexed', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { uidValidity: reindexedUidValidity }),
          tagInput([existingUid, secondUid]),
        ),
      ),
    );

    expect(error._tag).toBe('StaleUidError');
    expect(error.message).toContain('was reindexed');
    expect(events).toEqual([]);
  });

  it('never reports full success when a draft disappears during STORE', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { foundAfterUpdate: [existingUid] }),
          tagInput([existingUid, secondUid]),
        ),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain(`missing uids ${secondUid}`);
    expect(events).toEqual([`tag:${existingUid},${secondUid}:${keyword}`]);
  });

  it('never reports success when STORE omits the requested keyword', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient([], { flagsAfterUpdate: [] }),
          tagInput([existingUid]),
        ),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain(`keyword absent from uids ${existingUid}`);
  });
});
