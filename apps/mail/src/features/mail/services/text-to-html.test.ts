import { describe, expect, it } from 'bun:test';
import { textToHtml } from './text-to-html';

describe('textToHtml', () => {
  it('escapes HTML-special characters', () => {
    expect(textToHtml('Is 2 < 3 & "yes"?')).toBe(
      '<p>Is 2 &lt; 3 &amp; &quot;yes&quot;?</p>',
    );
  });

  it('wraps blank-line-separated paragraphs and keeps single line breaks', () => {
    expect(textToHtml('First line\nsecond line\n\nNext paragraph\n')).toBe(
      '<p>First line<br>second line</p>\n<p>Next paragraph</p>',
    );
  });
});
