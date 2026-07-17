import { describe, expect, it } from 'bun:test';
import type { FullMessage } from '../schemas/mail';
import { buildReplyContent } from './reply-quote';

const replyAttributionPattern =
  /^It is\.\n\nOn July \d{1,2}, 2026 at \d{2}:\d{2}, Sender & Co <sender@example\.com> wrote:\n> Is 2 < 3\?\n> Yes & no\.$/u;

const message: FullMessage = {
  uid: 42,
  folder: 'INBOX',
  from: 'Sender & Co <sender@example.com>',
  to: 'recipient@example.com',
  cc: '',
  subject: 'Question',
  date: '2026-07-13T08:30:00.000Z',
  messageId: '<current@example.com>',
  inReplyTo: '<first@example.com>',
  references: ['<first@example.com>', '<current@example.com>'],
  text: 'Is 2 < 3?\nYes & no.',
  html: '<img src="https://example.com/tracking-pixel">',
  attachments: [],
};

describe('buildReplyContent', () => {
  it('adds a plain-text quotation without duplicating references', () => {
    const result = buildReplyContent('It is.', '<p>It is.</p>', message);

    expect(result.text).toMatch(replyAttributionPattern);
    expect(result.text).not.toContain(message.date);
    expect(result.inReplyTo).toBe('<current@example.com>');
    expect(result.references).toEqual([
      '<first@example.com>',
      '<current@example.com>',
    ]);
  });

  it('quotes escaped plain text in HTML instead of copying remote content', () => {
    const result = buildReplyContent('<p>It is.</p>', '<p>It is.</p>', message);

    expect(result.html).toContain(
      'Sender &amp; Co &lt;sender@example.com&gt; wrote:',
    );
    expect(result.html).toContain(
      '<blockquote type="cite">Is 2 &lt; 3?<br>Yes &amp; no.</blockquote>',
    );
    expect(result.html).not.toContain('tracking-pixel');
  });

  it('uses In-Reply-To as ancestry when References is absent', () => {
    const result = buildReplyContent('It is.', '<p>It is.</p>', {
      ...message,
      references: [],
    });

    expect(result.references).toEqual([
      '<first@example.com>',
      '<current@example.com>',
    ]);
  });

  it('preserves an unrecognized date instead of dropping the attribution', () => {
    const result = buildReplyContent('It is.', '<p>It is.</p>', {
      ...message,
      date: 'A recent Tuesday',
    });

    expect(result.text).toContain(
      'On A recent Tuesday, Sender & Co <sender@example.com> wrote:',
    );
  });
});
