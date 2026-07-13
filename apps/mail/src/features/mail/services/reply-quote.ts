import type { FullMessage } from '../schemas/mail';

type ReplyContent = {
  readonly text: string;
  readonly html: string | undefined;
  readonly inReplyTo: string | undefined;
  readonly references: ReadonlyArray<string>;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const attributionFor = (message: FullMessage): string => {
  if (message.date !== '' && message.from !== '') {
    return `On ${message.date}, ${message.from} wrote:`;
  }
  if (message.from !== '') {
    return `${message.from} wrote:`;
  }
  if (message.date !== '') {
    return `On ${message.date}, the sender wrote:`;
  }
  return 'Previous message:';
};

const quotePlainText = (text: string): string =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');

const quoteHtmlText = (text: string): string =>
  escapeHtml(text.trimEnd()).replaceAll('\n', '<br>');

const threadReferences = (message: FullMessage): ReadonlyArray<string> => {
  const ancestry =
    message.references.length > 0
      ? message.references
      : [message.inReplyTo].filter((reference) => reference !== '');
  return [...new Set([...ancestry, message.messageId])].filter(
    (reference) => reference !== '',
  );
};

export const buildReplyContent = (
  text: string,
  html: string | undefined,
  message: FullMessage,
): ReplyContent => {
  const attribution = attributionFor(message);
  return {
    text: `${text.trimEnd()}\n\n${attribution}\n${quotePlainText(message.text)}`,
    html:
      html === undefined
        ? undefined
        : `${html.trimEnd()}\n<p>${escapeHtml(attribution)}</p>\n<blockquote type="cite">${quoteHtmlText(message.text)}</blockquote>`,
    inReplyTo: message.messageId === '' ? undefined : message.messageId,
    references: threadReferences(message),
  };
};
