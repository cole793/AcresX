// The LinkedIn button in the top bar of the served homepage (public/index.html .top-actions).
// Served through the Worker so the polish scripts are injected, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { readPublic } from './ui-harness.js';

const env = { ASSETS: { fetch: async () => new Response(readPublic('index.html'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) } };

async function homepage() {
  const response = await worker.fetch(new Request('https://acresx.test/'), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  return response.text();
}

test('served homepage links to the AcresX LinkedIn page in a new tab', async () => {
  const html = await homepage();
  const links = [...html.matchAll(/<a\b[^>]*href="https:\/\/www\.linkedin\.com\/company\/acresx\/"[^>]*>/g)].map(m => m[0]);
  assert.equal(links.length, 1, 'expected exactly one LinkedIn link');
  const [link] = links;
  assert.match(link, /\btarget="_blank"/);
  assert.match(link, /\brel="noopener noreferrer"/);
  assert.match(link, /\baria-label="AcresX on LinkedIn"/);
  assert.match(link, /\btitle="[^"]+"/);
});

test('LinkedIn link sits after the Save and Generate report buttons and loads nothing external', async () => {
  const html = await homepage();
  const actions = html.match(/<div class="top-actions">([\s\S]*?)<\/div><\/header>/)?.[1] || '';
  // property-actions.js takes the first two buttons; property-report-v2.js uses button:nth-child(2).
  const order = [...actions.matchAll(/<(button|a)\b/g)].map(m => m[1]);
  assert.deepEqual(order, ['button', 'button', 'a']);
  assert.match(actions, /<svg\b[^>]*aria-hidden="true"/);
  assert.doesNotMatch(actions, /<img\b|<script\b|url\(/);
});
