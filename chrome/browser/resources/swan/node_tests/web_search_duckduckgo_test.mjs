// Run with:  node --test chrome/browser/resources/coda/*_test.mjs
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
  CodaAgent, finishLogin, loopbackRedirectUri, parseAuthCallback, startLogin,
} from '../coda_client.ts';
import {
  buildDuckDuckGoUrl, decodeEntities, DuckDuckGoProvider, htmlToText,
  parseDuckDuckGoHtml, resolveResultUrl,
} from '../web_search_duckduckgo.ts';

const REAL = readFileSync(
    new URL('./testdata/ddg_results_real.html', import.meta.url), 'utf8');

// ── DuckDuckGo parsing (real captured markup) ──

test('parses the real DuckDuckGo results page', () => {
  const r = parseDuckDuckGoHtml(REAL);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(x => x.url), [
    'https://www.swn.kr/',
    'https://namu.wiki/w/%EC%88%98%EC%99%84%EB%89%B4%EC%8A%A4',
    'https://www.facebook.com/suwannews/',
  ]);
  assert.equal(r[0].title, '수완뉴스');
  assert.match(r[0].snippet, /^수완뉴스\(The Suwan News\)는 정치, 사회/);
  assert.equal(r[1].title, '수완뉴스 - 나무위키');
  for (const x of r) assert.ok(!/[<>]/.test(x.title + x.snippet));
});

test('max limits the number of results', () => {
  assert.equal(parseDuckDuckGoHtml(REAL, {max: 2}).length, 2);
});

test('skips ads and DuckDuckGo-internal links (synthetic markup)', () => {
  const ad = `<div class="result results_links results_links_deep result--ad">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fads.example.com%2F">AD</a>
    <a class="result__snippet" href="#">ad text</a><div class="clear"></div></div>`;
  const internal = `<div class="result results_links web-result">
    <a rel="nofollow" class="result__a" href="/y.js?foo=1">internal</a><div class="clear"></div></div>`;
  const out = parseDuckDuckGoHtml(ad + internal + REAL);
  assert.equal(out.length, 3);
  assert.ok(!out.some(x => x.url.includes('ads.example.com')));
});

test('escaped markup in titles stays text, entities are decoded once', () => {
  const html = `<div class="result results_links web-result">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example.com%2F">A &amp; B &lt;script&gt;x&lt;/script&gt;</a>
    <a class="result__snippet" href="#">it&#x27;s <b>bold</b> &#54620;</a><div class="clear"></div></div>`;
  const [r] = parseDuckDuckGoHtml(html);
  assert.equal(r.title, 'A & B <script>x</script>');  // text, never markup
  assert.equal(r.snippet, 'it\'s bold 한');
});

test('bot check and markup changes are errors, not empty results', () => {
  assert.throws(() => parseDuckDuckGoHtml('<div class="anomaly-modal__title">'), {code: 'search_blocked'});
  assert.throws(
      () => parseDuckDuckGoHtml('<div class="result results_links"><p>new layout</p></div>'),
      {code: 'search_parse'});
  assert.deepEqual(parseDuckDuckGoHtml('<html><body>No results.</body></html>'), []);
});

test('result URL resolution rejects non-web schemes', () => {
  assert.equal(resolveResultUrl('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)'), null);
  assert.equal(resolveResultUrl('//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fa.example.com%2F'), null);
  assert.equal(resolveResultUrl('//duckduckgo.com/l/'), null);
  assert.equal(resolveResultUrl('https://a.example.com/x'), 'https://a.example.com/x');
});

test('search URL is DuckDuckGo html endpoint with Korean region, query capped', () => {
  const u = new URL(buildDuckDuckGoUrl('수완뉴스  청소년\n지원'));
  assert.equal(u.origin + u.pathname, 'https://html.duckduckgo.com/html/');
  assert.equal(u.searchParams.get('q'), '수완뉴스 청소년 지원');
  assert.equal(u.searchParams.get('kl'), 'kr-kr');
  assert.equal(new URL(buildDuckDuckGoUrl('가'.repeat(500))).searchParams.get('q').length, 200);
});

test('decodeEntities ignores unknown/invalid entities', () => {
  assert.equal(decodeEntities('&foo; &#0; &#x110000; &amp;'), '&foo; &#0; &#x110000; &');
});

// ── page text extraction ──

test('htmlToText drops scripts/nav and prefers the article body', () => {
  const body = '본문 문장입니다. '.repeat(30);
  const html = `<html><head><title>t</title><script>evil()</script></head><body>
    <nav>메뉴 메뉴</nav><article><h1>제목</h1><p>${body}</p></article><footer>푸터</footer></body></html>`;
  const t = htmlToText(html);
  assert.match(t, /제목/);
  assert.match(t, /본문 문장입니다/);
  assert.ok(!/evil|메뉴|푸터/.test(t));
  assert.ok(htmlToText(html, {maxChars: 50}).length <= 50);
});

// ── provider ──

test('provider searches through the injected isolated fetcher', async () => {
  const seen = [];
  const p = new DuckDuckGoProvider({fetchText: async (url) => { seen.push(url); return REAL; }});
  const out = await p.search('수완뉴스', {count: 2});
  assert.equal(out.length, 2);
  assert.match(seen[0], /^https:\/\/html\.duckduckgo\.com\/html\/\?/);
});

test('provider refuses to read internal pages even if asked directly', async () => {
  let fetched = false;
  const p = new DuckDuckGoProvider({fetchText: async () => { fetched = true; return ''; }});
  await assert.rejects(p.fetchPageText('http://192.168.0.1/'), {code: 'unsafe_url'});
  assert.equal(fetched, false);
});

test('agent + DuckDuckGo provider end to end (fake gateway)', async () => {
  const gw = {
    status: async () => ({configured: true, features: {chat: true, search: true, summarize: true}}),
    chat: async () => ({reply: '', path: 'no-evidence', sources: []}),
    search: async () => ({results: []}),
    summarize: async (text) => ({summary: `요약(${text.length})`}),
  };
  const page = `<article>${'<p>수완뉴스는 청소년 기자가 만드는 매체입니다.</p>'.repeat(20)}</article>`;
  const provider = new DuckDuckGoProvider({
    fetchText: async (url) => url.startsWith('https://html.duckduckgo.com/') ? REAL : page,
  });
  const out = await new CodaAgent(gw, {webProvider: provider, options: {webSearch: true, maxWebPages: 2}})
                  .ask('수완뉴스가 뭐야');
  assert.equal(out.answerSource, 'web');
  assert.equal(out.web.items.length, 2);
  assert.match(out.web.items[0].summary, /^요약\(/);
  assert.equal(out.web.items[0].url, 'https://www.swn.kr/');
});

// ── loopback login ──

test('loopback redirect: only ephemeral loopback ports', () => {
  assert.equal(loopbackRedirectUri(53211), 'http://127.0.0.1:53211/callback');
  for (const bad of [0, 80, 1023, 65536, 1.5, '8080', NaN]) {
    assert.throws(() => loopbackRedirectUri(bad), {code: 'bad_port'}, String(bad));
  }
});

test('login start → callback → token exchange uses PKCE and loopback URI', async () => {
  const cfg = {base: 'https://www.swn.kr', clientId: 'client_x', scope: 'basic profile coda:chat', port: 53211};
  const {authorizeUrl, pending} = await startLogin(cfg, webcrypto);
  const a = new URL(authorizeUrl);
  assert.equal(a.searchParams.get('redirect_uri'), 'http://127.0.0.1:53211/callback');
  assert.equal(a.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(a.searchParams.get('state'), pending.state);

  let sent;
  const tokens = await finishLogin({
    ...cfg,
    callbackUrl: `http://127.0.0.1:53211/callback?code=CODE&state=${pending.state}`,
    pending,
  }, async (url, init) => {
    sent = new URLSearchParams(init.body);
    return {ok: true, status: 200, headers: {get: () => null},
            json: async () => ({access_token: 'AT', refresh_token: 'RT', expires_in: 3600})};
  });
  assert.equal(tokens.accessToken, 'AT');
  assert.equal(sent.get('code_verifier'), pending.verifier);
  assert.equal(sent.get('redirect_uri'), 'http://127.0.0.1:53211/callback');
  assert.equal(sent.get('client_secret'), null);
});

test('callback on the wrong origin/path or with a wrong state is rejected', async () => {
  const {pending} = await startLogin(
      {base: 'https://www.swn.kr', clientId: 'c', scope: 'basic', port: 53211}, webcrypto);
  const ok = `state=${pending.state}&code=C`;
  const opts = {redirectUri: pending.redirectUri};
  for (const bad of [
    `http://127.0.0.1:53212/callback?${ok}`,  // different port = different listener
    `http://localhost:53211/callback?${ok}`,
    `http://127.0.0.1:53211/evil?${ok}`,
    `https://127.0.0.1:53211/callback?${ok}`,
  ]) {
    assert.throws(() => parseAuthCallback(bad, pending.state, opts), {code: 'bad_callback'}, bad);
  }
  assert.throws(
      () => parseAuthCallback('http://127.0.0.1:53211/callback?state=zzz&code=C', pending.state, opts),
      {code: 'state_mismatch'});
});
