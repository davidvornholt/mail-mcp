import type { SearchObject } from 'imapflow';
import type { SearchOptions } from '../schemas/mail';

// Translate our SearchOptions into an imapflow SearchObject. A general `query`
// becomes a full-text search (headers + body); narrow fields map directly.
// With no criteria we match everything so the caller can list recent messages.
export const buildSearchQuery = (options: SearchOptions): SearchObject => {
  const query: SearchObject = {
    ...(options.query === undefined ? {} : { text: options.query }),
    ...(options.from === undefined ? {} : { from: options.from }),
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    ...(options.since === undefined ? {} : { since: options.since }),
  };
  return Object.keys(query).length === 0 ? { all: true } : query;
};
