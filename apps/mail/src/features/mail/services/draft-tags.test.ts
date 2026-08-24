import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { tagDrafts } from './draft-tags';
import {
  draftsFolder,
  existingUid,
  fakeClient,
  handle,
  missingUid,
  reindexedUidValidity,
  secondUid,
  tagKey,
} from './draft-tags.test-support';

describe('tagDrafts validation', () => {
  it('validates and tags all unique draft uids in one update', async () => {
    const events: Array<string> = [];
    const result = await Effect.runPromise(
      tagDrafts(fakeClient(events), {
        folder: draftsFolder,
        drafts: [handle(existingUid), handle(secondUid), handle(existingUid)],
        tagKey,
      }),
    );

    expect(events).toEqual([`tag:${existingUid},${secondUid}:${tagKey}`]);
    const taggedDrafts = [handle(existingUid), handle(secondUid)];
    expect(result).toEqual({
      folder: draftsFolder,
      drafts: taggedDrafts,
      tagKey,
      tagged: taggedDrafts.length,
    });
  });

  it('reports every missing uid before changing flags', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { foundBeforeUpdate: [existingUid] }), {
          folder: draftsFolder,
          drafts: [handle(existingUid), handle(missingUid), handle(secondUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain(`uids ${missingUid}, ${secondUid}`);
    expect(events).toEqual([]);
  });

  it('refuses a tag the server does not persist', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { permanentFlags: ['\\Seen', '$label2'] }),
          {
            folder: draftsFolder,
            drafts: [handle(existingUid)],
            tagKey,
          },
        ),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain('does not allow tag');
    expect(events).toEqual([]);
  });

  it('uses the case-insensitive spelling advertised by the server', async () => {
    const events: Array<string> = [];
    const result = await Effect.runPromise(
      tagDrafts(fakeClient(events, { permanentFlags: ['$LABEL1'] }), {
        folder: draftsFolder,
        drafts: [handle(existingUid)],
        tagKey: '$label1',
      }),
    );

    expect(events).toEqual([`tag:${existingUid}:$LABEL1`]);
    expect(result.tagKey).toBe('$LABEL1');
  });
});

describe('tagDrafts completion', () => {
  it('reports when the server rejects the flag update', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([], { updateResult: false }), {
          folder: draftsFolder,
          drafts: [handle(existingUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain('server rejected the update');
  });

  it('refuses messages outside the drafts folder', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([]), {
          folder: 'INBOX',
          drafts: [handle(existingUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('DraftError');
  });

  it('refuses every update when the drafts mailbox was reindexed', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { uidValidity: reindexedUidValidity }), {
          folder: draftsFolder,
          drafts: [handle(existingUid), handle(secondUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('StaleUidError');
    expect(error.message).toContain('was reindexed');
    expect(events).toEqual([]);
  });

  it('rejects handles from different mailbox generations before STORE', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { uidValidity: reindexedUidValidity }), {
          folder: draftsFolder,
          drafts: [handle(existingUid), handle(secondUid, '222')],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain('mixed uidValidity handles');
    expect(events).toEqual([]);
  });

  it('never reports full success when a draft disappears during STORE', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { foundAfterUpdate: [existingUid] }), {
          folder: draftsFolder,
          drafts: [handle(existingUid), handle(secondUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain(`missing uids ${secondUid}`);
    expect(events).toEqual([`tag:${existingUid},${secondUid}:${tagKey}`]);
  });

  it('never reports success when STORE omits the requested tag', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([], { flagsAfterUpdate: [] }), {
          folder: draftsFolder,
          drafts: [handle(existingUid)],
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain(`tag absent from uids ${existingUid}`);
  });
});
