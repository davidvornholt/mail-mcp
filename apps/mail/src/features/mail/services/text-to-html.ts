export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const paragraphBreak = /\n{2,}/u;

export const textToHtml = (text: string): string =>
  text
    .trim()
    .split(paragraphBreak)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`,
    )
    .join('\n');
