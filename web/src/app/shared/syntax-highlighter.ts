import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const languageByFilename: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  gnumakefile: 'makefile',
  makefile: 'makefile',
};

const languageByExtension: Readonly<Record<string, string>> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  cxx: 'cpp',
  dockerfile: 'dockerfile',
  go: 'go',
  h: 'c',
  hh: 'cpp',
  htm: 'xml',
  html: 'xml',
  hpp: 'cpp',
  hxx: 'cpp',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mk: 'makefile',
  mts: 'typescript',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

registerHighlightLanguages();

export function languageForPath(path: string): string | null {
  const normalizedPath = path.toLowerCase();
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  const filenameLanguage = languageByFilename[fileName];
  if (filenameLanguage != null) {
    return filenameLanguage;
  }

  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : '';
  return languageByExtension[extension] ?? null;
}

export function isSyntaxLanguageSupported(language: string | null): boolean {
  return language != null && hljs.getLanguage(language) != null;
}

export function highlightCode(content: string, language: string | null): string {
  if (content === '') {
    return '&nbsp;';
  }
  if (isSyntaxLanguageSupported(language)) {
    return hljs.highlight(content, { language: language!, ignoreIllegals: true }).value;
  }
  return escapeCodeHtml(content);
}

export function escapeCodeHtml(content: string): string {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function registerHighlightLanguages(): void {
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('c', c);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('kotlin', kotlin);
  hljs.registerLanguage('makefile', makefile);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('scss', scss);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('yaml', yaml);
}
