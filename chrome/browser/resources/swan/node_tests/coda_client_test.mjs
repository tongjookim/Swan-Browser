// Run with:  node --test chrome/browser/resources/coda/
// (Node >= 18, no dependencies.)
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';

import {
  buildAuthorizeUrl, CodaAgent, CodaError, createPkcePair, exchangeCode,
  GatewayClient, isSafeWebUrl, parseAuthCallback, reformulate,
} from '../coda_client.ts';

// ── helpers ──

function jsonRes(body, {status = 200, headers = {}} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: k => headers[k] ?? null},
    json: async () => body,
  };
}

function memoryStore(tokens) {
  let t = tokens;
  return {
    load: async () => t,
    save: async x => { t = x; },
    clear: async () => { t = null; },
    peek: () => t,
  };
}

const FRESH = {accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600e3};

// ── PKCE ──

test('PKCE pair: 43-char verifier, challenge = base64url(sha256(verifier))', async () => {
  const {verifier, challenge} = await createPkcePair(webcrypto);
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9\-_]{43}$/);
  const digest = Buffer.from(
      await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  assert.equal(challenge, digest.toString('base64url'));
});

test('PKCE matches the RFC 7636 appendix B vector (same as server README)', async () => {
  // We can't inject the verifier into createPkcePair, so check the primitive
  // the same way the server does.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const digest = Buffer.from(
      await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  assert.equal(digest.toString('base64url'),
               'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('authorize URL carries S256 challenge and state', () => {
  const url = new URL(buildAuthorizeUrl({
    base: 'https://www.swn.kr/', clientId: 'client_x',
    redirectUri: 'http://127.0.0.1/cb', scope: 'basic coda:chat',
    state: 'S', challenge: 'C'.repeat(43)}));
  assert.equal(url.origin + url.pathname, 'https://www.swn.kr/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'S');
  assert.equal(url.searchParams.get('scope'), 'basic coda:chat');
});

test('callback: state mismatch, error and missing code are rejected', () => {
  assert.equal(parseAuthCallback('http://127.0.0.1/cb?code=abc&state=S', 'S'), 'abc');
  assert.throws(() => parseAuthCallback('http://127.0.0.1/cb?code=abc&state=X', 'S'),
                {code: 'state_mismatch'});
  assert.throws(() => parseAuthCallback('http://127.0.0.1/cb?error=access_denied&state=S', 'S'),
                {code: 'access_denied'});
  assert.throws(() => parseAuthCallback('http://127.0.0.1/cb?state=S', 'S'),
                {code: 'missing_code'});
});

test('code exchange sends verifier and no client_secret', async () => {
  let sent;
  const t = await exchangeCode(
      {base: 'https://www.swn.kr', clientId: 'c', redirectUri: 'r', code: 'k', verifier: 'v'},
      async (url, init) => {
        sent = {url, body: new URLSearchParams(init.body)};
        return jsonRes({access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'basic'});
      });
  assert.equal(sent.url, 'https://www.swn.kr/oauth/token');
  assert.equal(sent.body.get('code_verifier'), 'v');
  assert.equal(sent.body.get('client_secret'), null);
  assert.equal(t.accessToken, 'AT');
});

// ── Gateway client ──

test('expired token is refreshed once even for concurrent calls (rotation-safe)', async () => {
  const store = memoryStore({accessToken: 'OLD', refreshToken: 'RT0', expiresAt: 0});
  let refreshCalls = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      refreshCalls++;
      await new Promise(r => setTimeout(r, 10));
      return jsonRes({access_token: 'NEW', refresh_token: 'RT1', expires_in: 3600});
    }
    assert.equal(init.headers.Authorization, 'Bearer NEW');
    return jsonRes({ok: true, data: {reply: 'hi'}});
  };
  const gw = new GatewayClient({base: 'https://x', clientId: 'c', tokenStore: store, fetchImpl});
  const [a, b] = await Promise.all([gw.chat('a'), gw.chat('b')]);
  assert.equal(a.reply, 'hi');
  assert.equal(b.reply, 'hi');
  assert.equal(refreshCalls, 1);
  assert.equal(store.peek().refreshToken, 'RT1');
});

test('a 5xx during refresh does not log the user out; invalid_grant does', async () => {
  const mk = status => new GatewayClient({
    base: 'https://x', clientId: 'c',
    tokenStore: memoryStore({accessToken: 'o', refreshToken: 'r', expiresAt: 0}),
    fetchImpl: async () => jsonRes(status === 500 ? {} : {error: 'invalid_grant'}, {status: status === 500 ? 500 : 400}),
  });
  const a = mk(500);
  await assert.rejects(a.chat('x'));
  assert.ok(await a.tokenStore.load());
  const b = mk(400);
  await assert.rejects(b.chat('x'), {code: 'invalid_grant'});
  assert.equal(await b.tokenStore.load(), null);
});

test('429 surfaces Retry-After', async () => {
  const gw = new GatewayClient({
    base: 'https://x', clientId: 'c', tokenStore: memoryStore(FRESH),
    fetchImpl: async () => jsonRes(
        {code: 'wpos_coda_rate_limited', message: 'slow'}, {status: 429, headers: {'retry-after': '17'}}),
  });
  await assert.rejects(gw.chat('x'), e =>
      e instanceof CodaError && e.retryAfter === 17 && e.status === 429);
});

// ── Agent ──

function fakeGateway({chat, search = [], summaries = [], features = {chat: true, search: true, summarize: true}}) {
  const calls = {chat: 0, search: [], summarize: []};
  return {
    calls,
    status: async () => ({configured: true, features}),
    chat: async () => { calls.chat++; return chat; },
    search: async q => {
      calls.search.push(q);
      return {results: search.shift() || []};
    },
    summarize: async text => { calls.summarize.push(text); return {summary: summaries.shift() || 'S'}; },
  };
}

test('confident chat answer triggers no extra search', async () => {
  const gw = fakeGateway({chat: {reply: 'r', path: 'extractive', sources: [{text: 't', score: 0.9}]}});
  const out = await new CodaAgent(gw).ask('질문');
  assert.equal(out.answerSource, 'chat');
  assert.equal(gw.calls.search.length, 0);
});

test('no-evidence chat → auto corpus search, stops once enough hits', async () => {
  const hit = (t, s) => ({text: t, score: s, accepted: true});
  const gw = fakeGateway({
    chat: {reply: '근거 없음', path: 'no-evidence', sources: []},
    search: [[hit('a', 0.8), hit('b', 0.7)], [hit('c', 0.6), hit('a', 0.8)]],
  });
  const out = await new CodaAgent(gw).ask('위기청소년 지원 사업 알려줘');
  assert.equal(out.answerSource, 'corpus');
  assert.deepEqual(out.evidence.map(e => e.text), ['a', 'b', 'c']);
  assert.ok(gw.calls.search.length <= 3);
});

test('search budget is capped by maxSearchRounds', async () => {
  const gw = fakeGateway({chat: {reply: '', path: 'no-evidence', sources: []}});
  await new CodaAgent(gw, {options: {maxSearchRounds: 1}}).ask('아주 긴 질문 하나 두 개 세 개 네 개 다섯 개 여섯 개 일곱 개 알려줘');
  assert.equal(gw.calls.search.length, 1);
});

test('web search is off by default and needs a provider', async () => {
  const gw = fakeGateway({chat: {reply: '', path: 'no-evidence', sources: []}});
  let used = false;
  const provider = {search: async () => { used = true; return []; }, fetchPageText: async () => ''};
  const out = await new CodaAgent(gw, {webProvider: provider}).ask('q');
  assert.equal(used, false);
  assert.equal(out.answerSource, 'none');
});

test('web search: filters unsafe URLs, caps pages, summarizes via gateway', async () => {
  const gw = fakeGateway({chat: {reply: '', path: 'no-evidence', sources: []}, summaries: ['요약1', '요약2']});
  const fetched = [];
  const provider = {
    search: async () => [
      {title: 'internal', url: 'http://192.168.0.1/admin', snippet: ''},
      {title: 'a', url: 'https://a.example.com/x', snippet: 'sa'},
      {title: 'b', url: 'https://b.example.com/y', snippet: 'sb'},
      {title: 'c', url: 'https://c.example.com/z', snippet: 'sc'},
    ],
    fetchPageText: async url => { fetched.push(url); return 'x'.repeat(9000); },
  };
  const out = await new CodaAgent(gw, {
    webProvider: provider, options: {webSearch: true, maxWebPages: 2},
  }).ask('오늘 서울 날씨');
  assert.equal(out.answerSource, 'web');
  assert.deepEqual(fetched, ['https://a.example.com/x', 'https://b.example.com/y']);
  assert.deepEqual(out.web.items.map(i => i.summary), ['요약1', '요약2']);
  assert.ok(gw.calls.summarize.every(t => t.length <= 4000));
  assert.ok(out.steps.some(s => s.kind === 'web-skip'));
});

test('without coda:page scope web results are returned without page reads', async () => {
  const gw = fakeGateway({
    chat: {reply: '', path: 'no-evidence', sources: []},
    features: {chat: true, search: true, summarize: false},
  });
  let read = false;
  const provider = {
    search: async () => [{title: 'a', url: 'https://a.example.com/', snippet: 's'}],
    fetchPageText: async () => { read = true; return 'x'; },
  };
  const out = await new CodaAgent(gw, {webProvider: provider, options: {webSearch: true}}).ask('q');
  assert.equal(read, false);
  assert.equal(out.web.items[0].summary, '');
});

test('forceWeb searches the web even when CODA had an answer', async () => {
  const gw = fakeGateway({chat: {reply: 'r', path: 'extractive', sources: [{score: 0.9}]}});
  const provider = {
    search: async () => [{title: 'a', url: 'https://a.example.com/', snippet: 's'}],
    fetchPageText: async () => 'text',
  };
  const out = await new CodaAgent(gw, {webProvider: provider, options: {webSearch: true}})
                  .ask('q', {forceWeb: true});
  assert.equal(out.answerSource, 'web');
});

// ── URL safety / query rewriting ──

test('isSafeWebUrl blocks internal and non-web targets', () => {
  for (const bad of [
    'file:///etc/passwd', 'javascript:alert(1)', 'ftp://a.example.com/',
    'http://localhost/', 'http://foo.localhost/', 'http://127.0.0.1/',
    'http://2130706433/', 'http://0x7f.1/', 'http://10.0.0.5/', 'http://172.16.0.1/',
    'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://intranet/',
    'http://printer.local/', 'https://user:pw@a.example.com/', 'not a url', '',
  ]) {
    assert.equal(isSafeWebUrl(bad), false, bad);
  }
  for (const good of ['https://www.swn.kr/a?b=1', 'http://example.com/']) {
    assert.equal(isSafeWebUrl(good), true, good);
  }
});

test('reformulate strips request noise and de-duplicates', () => {
  assert.deepEqual(reformulate('청년 취업 지원 알려줘?'), ['청년 취업 지원 알려줘?', '청년 취업 지원']);
  assert.deepEqual(reformulate('청년 취업'), ['청년 취업']);
});
