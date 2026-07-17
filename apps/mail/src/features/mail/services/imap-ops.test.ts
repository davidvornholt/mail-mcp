import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { readMessage } from './imap-ops';
import { buildReplyContent } from './reply-quote';

const frozenTime = new Date('2031-02-03T04:05:06.000Z');
const messageUid = 42;
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const localTimestamp = (value: string): string => {
  const date = new Date(value);
  const month = months[date.getMonth()];
  return `${month} ${date.getDate()}, ${date.getFullYear()} at ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const sourceFor = (date: string | undefined): Buffer => {
  const dateHeader =
    date === undefined ? [] : [date === '' ? 'Date:' : `Date: ${date}`];
  return Buffer.from(
    [
      ...dateHeader,
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
    const cases = [
      {
        raw: 'Mon, 13 Jul 2026 10:30:00 +0200',
        normalized: '2026-07-13T08:30:00.000Z',
        attribution: `On ${localTimestamp('Mon, 13 Jul 2026 10:30:00 +0200')}, "Original Sender" <original@example.com> wrote:`,
      },
      {
        raw: 'Mon, 13 Jul 2026 10:30:00',
        normalized: new Date('Mon, 13 Jul 2026 10:30:00').toISOString(),
        attribution:
          'On July 13, 2026 at 10:30, "Original Sender" <original@example.com> wrote:',
      },
      {
        raw: undefined,
        normalized: '',
        attribution: '"Original Sender" <original@example.com> wrote:',
      },
      {
        raw: '',
        normalized: frozenTime.toISOString(),
        attribution: '"Original Sender" <original@example.com> wrote:',
      },
      {
        raw: 'A recent Tuesday',
        normalized: frozenTime.toISOString(),
        attribution:
          'On A recent Tuesday, "Original Sender" <original@example.com> wrote:',
      },
    ] as const;

    const results = await Promise.all(
      cases.map(async (testCase) => ({
        message: await readSource(sourceFor(testCase.raw)),
        testCase,
      })),
    );

    for (const { message, testCase } of results) {
      const reply = buildReplyContent('Reply', '<p>Reply</p>', message);
      const attribution = reply.text.split('\n').at(2);

      expect(message.date).toBe(testCase.normalized);
      expect(message.attributionDate).toBe(testCase.raw ?? '');
      expect(attribution).toBe(testCase.attribution);
    }
  });
});
