import type { SearchOptions } from '../schemas/mail';
import type { MailboxSearchHit } from './imap-search';

export const searchOptions: SearchOptions = {
  scope: 'all',
  query: 'invoice',
  limit: 2,
};

export const mailboxHit = (
  uid: number,
  messageId: string,
  receivedAt: string,
): MailboxSearchHit => ({
  hit: {
    uid,
    folder: 'INBOX',
    from: 'sender@example.com',
    to: 'me@example.com',
    subject: messageId,
    date: receivedAt,
  },
  mailboxDeduplicationId: messageId,
  messageId,
  receivedAt,
});
