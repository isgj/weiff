import { escapeCodeHtml, highlightCode, languageForPath } from './syntax-highlighter';

describe('syntax highlighter', () => {
  it('detects languages by extension and filename', () => {
    expect(languageForPath('src/main.go')).toBe('go');
    expect(languageForPath('web/Dockerfile')).toBe('dockerfile');
    expect(languageForPath('notes.unknown')).toBeNull();
  });

  it('highlights a supported language', () => {
    const highlighted = highlightCode('package main', languageForPath('main.go'));

    expect(highlighted).toContain('<span class="hljs-keyword">package</span>');
  });

  it('escapes unsupported content', () => {
    expect(highlightCode('<script>alert("x")</script>', null)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeCodeHtml("a & b's")).toBe('a &amp; b&#039;s');
  });
});
