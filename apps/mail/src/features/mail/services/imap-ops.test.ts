import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { readMessage } from './imap-ops';
import { buildReplyContent } from './reply-quote';

const frozenTime = new Date('2031-02-03T04:05:06.000Z');
const messageUid = 42;
const replyHtmlLineCount = 3;

const sourceFor = (dates: ReadonlyArray<string>): Buffer => {
  const dateHeaders = dates.map((date) =>
    date === '' ? 'Date:' : `Date: ${date}`,
  );
  return Buffer.from(
    [
      ...dateHeaders,
      'From: Original Sender <original@example.com>',
      'To: recipient@example.com',
      'Subject: Question',
      'Message-ID: <current@example.com>',
      '',
      'Original body',
    ].join('\r\n'),
  );
};

const readSource = (source: Buffer) => {
  const client = {
    getMailboxLock: () => Promise.resolve({ release: () => undefined }),
    fetchOne: () => Promise.resolve({ uid: messageUid, source }),
  } as unknown as ImapFlow;
  return Effect.runPromise(readMessage(client, 'INBOX', messageUid));
};

afterEach(() => {
  setSystemTime();
});

describe('readMessage reply attribution dates', () => {
  it('carries raw Date semantics from MIME parsing into reply attribution', async () => {
    setSystemTime(frozenTime);
    const zoneBearingDate = 'Mon, 13 Jul 2026 10:30:00 +0200';
    const zoneBearingMessage = await readSource(sourceFor([zoneBearingDate]));
    const zoneBearingReply = buildReplyContent(
      'Reply',
      '<p>Reply</p>',
      zoneBearingMessage,
    );
    const zoneBearingAttribution = zoneBearingReply.text.split('\n').at(2);

    expect(zoneBearingMessage.date).toBe('2026-07-13T08:30:00.000Z');
    expect(zoneBearingMessage.attributionDate).toBe(zoneBearingDate);
    expect(zoneBearingAttribution?.startsWith('On ')).toBe(true);
    expect(
      zoneBearingAttribution?.endsWith(
        ', "Original Sender" <original@example.com> wrote:',
      ),
    ).toBe(true);
    expect(zoneBearingAttribution).not.toContain(zoneBearingDate);

    const literalCases = [
      {
        dates: ['Mon, 13 Jul 2026 10:30:00'],
        attributionDate: 'Mon, 13 Jul 2026 10:30:00',
        normalized: new Date('Mon, 13 Jul 2026 10:30:00').toISOString(),
        attribution:
          'On July 13, 2026 at 10:30, "Original Sender" <original@example.com> wrote:',
      },
      {
        dates: [],
        attributionDate: '',
        normalized: '',
        attribution: '"Original Sender" <original@example.com> wrote:',
      },
      {
        dates: [''],
        attributionDate: '',
        normalized: frozenTime.toISOString(),
        attribution: '"Original Sender" <original@example.com> wrote:',
      },
      {
        dates: ['A recent Tuesday'],
        attributionDate: 'A recent Tuesday',
        normalized: frozenTime.toISOString(),
        attribution:
          'On A recent Tuesday, "Original Sender" <original@example.com> wrote:',
      },
    ] as const;

    const results = await Promise.all(
      literalCases.map(async (testCase) => ({
        message: await readSource(sourceFor(testCase.dates)),
        testCase,
      })),
    );

    for (const { message, testCase } of results) {
      const reply = buildReplyContent('Reply', '<p>Reply</p>', message);
      const attribution = reply.text.split('\n').at(2);

      expect(message.date).toBe(testCase.normalized);
      expect(message.attributionDate).toBe(testCase.attributionDate);
      expect(attribution).toBe(testCase.attribution);
    }
  });

  it('unfolds the selected last raw Date before attribution', async () => {
    setSystemTime(frozenTime);
    const cases = [
      {
        dates: ['A recent Tuesday\r\n injected attribution line'],
        normalized: frozenTime.toISOString(),
        attributionDate: 'A recent Tuesday injected attribution line',
        attribution:
          'On A recent Tuesday injected attribution line, "Original Sender" <original@example.com> wrote:',
      },
      {
        dates: ['Mon, 13 Jul 2026 10:30:00', 'A recent Tuesday'],
        normalized: frozenTime.toISOString(),
        attributionDate: 'A recent Tuesday',
        attribution:
          'On A recent Tuesday, "Original Sender" <original@example.com> wrote:',
      },
      {
        dates: ['A recent Tuesday', 'Mon, 13 Jul 2026 10:30:00'],
        normalized: new Date('Mon, 13 Jul 2026 10:30:00').toISOString(),
        attributionDate: 'Mon, 13 Jul 2026 10:30:00',
        attribution:
          'On July 13, 2026 at 10:30, "Original Sender" <original@example.com> wrote:',
      },
    ] as const;
    const results = await Promise.all(
      cases.map(async (testCase) => ({
        message: await readSource(sourceFor(testCase.dates)),
        testCase,
      })),
    );

    for (const { message, testCase } of results) {
      const reply = buildReplyContent('Reply', '<p>Reply</p>', message);
      const attribution = reply.text.split('\n').at(2);

      expect(message.date).toBe(testCase.normalized);
      expect(message.attributionDate).toBe(testCase.attributionDate);
      expect(attribution).toBe(testCase.attribution);
      expect(reply.html).not.toContain('\r');
      expect(reply.html.split('\n')).toHaveLength(replyHtmlLineCount);
    }
  });
});
