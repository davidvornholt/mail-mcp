import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { requireDraftsFolder } from './draft';

describe('requireDraftsFolder', () => {
  const folders = [
    {
      path: 'INBOX',
      name: 'INBOX',
      specialUse: null,
      subscribed: true,
    },
    {
      path: 'Drafts',
      name: 'Drafts',
      specialUse: '\\Drafts',
      subscribed: true,
    },
  ];

  it('accepts the selected drafts folder', async () => {
    await expect(
      Effect.runPromise(requireDraftsFolder(folders, 'Drafts')),
    ).resolves.toBe('Drafts');
  });

  it('refuses folders outside drafts', async () => {
    const error = await Effect.runPromise(
      Effect.flip(requireDraftsFolder(folders, 'INBOX')),
    );
    expect(error._tag).toBe('DraftError');
  });
});
