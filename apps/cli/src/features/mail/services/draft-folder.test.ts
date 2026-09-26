import { describe, expect, it } from 'bun:test';
import type { FolderInfo } from '../schemas/mail';
import { selectDraftsFolder } from './draft-folder';

const folder = (
  path: string,
  name: string,
  specialUse: string | null,
): FolderInfo => ({ path, name, specialUse, subscribed: true });

describe('selectDraftsFolder', () => {
  it('prefers the \\Drafts special-use folder', () => {
    expect(
      selectDraftsFolder([
        folder('INBOX.Entwuerfe', 'Entwuerfe', '\\Drafts'),
        folder('INBOX.Drafts', 'Drafts', null),
      ]),
    ).toBe('INBOX.Entwuerfe');
  });

  it('falls back to a folder named Drafts', () => {
    expect(selectDraftsFolder([folder('INBOX.Drafts', 'Drafts', null)])).toBe(
      'INBOX.Drafts',
    );
  });

  it('defaults to "Drafts" when nothing matches', () => {
    expect(selectDraftsFolder([folder('INBOX', 'INBOX', null)])).toBe('Drafts');
  });
});
