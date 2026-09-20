import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { markdownSchema } from '../src/services/markdownSafety.ts';
const render = text => renderToStaticMarkup(React.createElement(ReactMarkdown, { rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSchema]] }, text));
test('preserves prescription details and styling while stripping active HTML', () => {
  const html=render('<details class="mb-2"><summary class="font-bold">30일 기준 약재 총량</summary><div class="grid grid-cols-2"><b>감초</b> 30g</div></details>');
  assert.match(html, /<details class="mb-2">/);assert.match(html, /<summary class="font-bold">/);assert.match(html, /감초/);assert.match(html, /grid-cols-2/);
  const unsafe=render('<iframe src="https://attacker.invalid"></iframe><input autofocus onfocus="alert(1)"><a href="javascript:alert(1)">link</a><div onclick="alert(1)"><script>alert(1)</script>safe text</div>');
  assert.doesNotMatch(unsafe, /<iframe|<script|onfocus|onclick|javascript:/);assert.match(unsafe,/safe text/);
});
