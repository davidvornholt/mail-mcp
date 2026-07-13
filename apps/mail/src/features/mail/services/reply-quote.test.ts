import { describe, expect, it } from 'bun:test';
import type { FullMessage } from '../schemas/mail';
import { buildReplyContent } from './reply-quote';

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
};

describe('buildReplyContent', () => {
  it('adds a plain-text quotation without duplicating references', () => {
    const result = buildReplyContent('It is.', '<p>It is.</p>', message);

    expect(result.text).toBe(
      [
        'It is.',
        '',
        'On 2026-07-13T08:30:00.000Z, Sender & Co <sender@example.com> wrote:',
        '> Is 2 < 3?',
        '> Yes & no.',
      ].join('\n'),
    );
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
});
