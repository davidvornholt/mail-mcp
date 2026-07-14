import { describe, expect, it } from 'bun:test';
import { attachmentResult, readAttachmentFields } from './mcp-contract';

describe('attachment MCP contract', () => {
  it('accepts only numeric IMAP body-part handles', () => {
    for (const valid of ['1', '2.1', '10.2.3']) {
      expect(readAttachmentFields.part.safeParse(valid).success).toBe(true);
    }
    for (const invalid of ['TEXT', '1.MIME', '0', '1..2', '../2']) {
      expect(readAttachmentFields.part.safeParse(invalid).success).toBe(false);
    }
  });

  it('returns metadata and attachment bytes as an embedded resource', () => {
    const result = attachmentResult(
      { account: 'me@example.com', folder: 'Inbox/Subfolder', uid: 42 },
      {
        part: '2.1',
        filename: 'notes.txt',
        contentType: 'text/plain',
        size: 5,
        disposition: 'attachment',
        contentId: null,
        content: Buffer.from('hello'),
      },
    );

    expect(result.structuredContent).toEqual({
      part: '2.1',
      filename: 'notes.txt',
      contentType: 'text/plain',
      size: 5,
      disposition: 'attachment',
      contentId: null,
    });
    expect(result.content[1]).toMatchObject({
      type: 'resource',
      resource: {
        mimeType: 'text/plain',
        blob: 'aGVsbG8=',
      },
    });
    expect(JSON.stringify(result.content[1])).toContain('part=2.1');
  });
});
