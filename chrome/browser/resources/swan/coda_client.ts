// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// CODA client for the SWAN browser: OAuth (PKCE S256, loopback redirect),
// the WordPress CODA gateway client, and the agent that decides when to search.
//
// Server counterpart: wp-oauth-server >= 1.2.0.
//   OAuth : {base}/oauth/authorize, {base}/oauth/token, {base}/oauth/revoke
//   CODA  : {base}/wp-json/wpos/v1/coda/{chat,search,summarize,status}
//
// This file must stay "erasable" TypeScript (no enums, namespaces or
// parameter properties) and use `import type` for types so that the node
// tests can run it directly (see coda_client_test.mjs).
//
// Security invariants (AGENT.md 3.5.2):
//  * No CODA API key and no OAuth client_secret ever lives in the browser.
//  * The page never talks to the network itself; every request is made by
//    the browser process through an injected FetchLike.
//  * All strings returned to the UI are plain text and must be escaped.

// ───────────────────────────── Types ─────────────────────────────

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: {get(name: string): string | null};
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: HttpInit) => Promise<HttpResponse>;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export interface TokenStore {
  load(): Promise<Tokens|null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ChatSource {
  text: string;
  score: number;
}

export interface ChatData {
  reply: string;
  path: string;
  sources?: ChatSource[];
}

export interface SearchHit {
  text: string;
  score: number;
  accepted: boolean;
}

export interface SearchData {
  results?: SearchHit[];
}

export interface SummarizeData {
  summary: string;
  keywords?: string[];
}

export interface StatusData {
  configured: boolean;
  features: {chat?: boolean, search?: boolean, summarize?: boolean};
  user?: string;
}

export interface HistoryItem {
  role: 'user'|'assistant';
  content: string;
}

export interface PendingLogin {
  redirectUri: string;
  state: string;
  verifier: string;
}

// ───────────────────────────── Errors ─────────────────────────────

export class CodaError extends Error {
  code: string;
  status: number;
  retryAfter: number;  // seconds, from Retry-After on 429

  constructor(
      code: string, message: string,
      opts: {status?: number, retryAfter?: number} = {}) {
    super(message);
    this.name = 'CodaError';
    this.code = code;
    this.status = opts.status ?? 0;
    this.retryAfter = opts.retryAfter ?? 0;
  }
}

// ───────────────────────────── PKCE / OAuth ─────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number, cryptoImpl: Crypto): string {
  const bytes = new Uint8Array(byteLength);
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

/**
 * RFC 7636. verifier = 32 random bytes -> 43 chars (the minimum the server
 * accepts); challenge = BASE64URL(SHA-256(verifier)).
 */
export async function createPkcePair(cryptoImpl: Crypto = globalThis.crypto):
    Promise<{verifier: string, challenge: string}> {
  const verifier = randomString(32, cryptoImpl);
  const digest = await cryptoImpl.subtle.digest(
      'SHA-256', new TextEncoder().encode(verifier));
  return {verifier, challenge: base64Url(new Uint8Array(digest))};
}

export function createState(cryptoImpl: Crypto = globalThis.crypto): string {
  return randomString(16, cryptoImpl);
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export function buildAuthorizeUrl(p: {
  base: string,
  clientId: string,
  redirectUri: string,
  scope: string,
  state: string,
  challenge: string,
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${trimSlash(p.base)}/oauth/authorize?${q}`;
}

// Loopback redirect (RFC 8252 7.3). The server ignores the port for public
// clients. The browser cancels the navigation to this URL inside the login tab
// before any network request, so nothing listens on the port.
export const LOOPBACK_HOST = '127.0.0.1';
export const LOOPBACK_PATH = '/callback';

export function loopbackRedirectUri(
    port: number, path: string = LOOPBACK_PATH): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new CodaError('bad_port', '유효하지 않은 로컬 포트입니다.');
  }
  return `http://${LOOPBACK_HOST}:${port}${path}`;
}

/** Step 1 of login: PKCE + state + the URL to open in the login tab. */
export async function startLogin(
    p: {base: string, clientId: string, scope: string, port: number},
    cryptoImpl: Crypto = globalThis.crypto):
    Promise<{authorizeUrl: string, pending: PendingLogin}> {
  const redirectUri = loopbackRedirectUri(p.port);
  const {verifier, challenge} = await createPkcePair(cryptoImpl);
  const state = createState(cryptoImpl);
  return {
    authorizeUrl: buildAuthorizeUrl({
      base: p.base,
      clientId: p.clientId,
      redirectUri,
      scope: p.scope,
      state,
      challenge,
    }),
    pending: {redirectUri, state, verifier},
  };
}

/**
 * Validates the URL the login tab was sent to and returns the auth code.
 * `state` must match (CSRF); OAuth errors (e.g. access_denied) are surfaced.
 * With `redirectUri` the callback must hit exactly that origin and path.
 */
export function parseAuthCallback(
    callbackUrl: string, expectedState: string,
    opts: {redirectUri?: string} = {}): string {
  const u = new URL(callbackUrl);
  if (opts.redirectUri) {
    const r = new URL(opts.redirectUri);
    if (u.origin !== r.origin || u.pathname !== r.pathname) {
      throw new CodaError('bad_callback', '예상하지 못한 콜백 주소입니다.');
    }
  }
  const err = u.searchParams.get('error');
  if (err) {
    throw new CodaError(err, `로그인이 거부되었습니다 (${err}).`);
  }
  if (!expectedState || u.searchParams.get('state') !== expectedState) {
    throw new CodaError('state_mismatch', '로그인 상태 값이 일치하지 않습니다.');
  }
  const code = u.searchParams.get('code');
  if (!code) {
    throw new CodaError('missing_code', '인가 코드가 없습니다.');
  }
  return code;
}

async function safeJson(res: HttpResponse): Promise<Record<string, unknown>|null> {
  try {
    const v = await res.json();
    return (v && typeof v === 'object') ? v as Record<string, unknown> : null;
  } catch (e) {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeTokens(json: Record<string, unknown>): Tokens {
  const expiresIn = typeof json['expires_in'] === 'number' ? json['expires_in'] : 0;
  return {
    accessToken: str(json['access_token']),
    refreshToken: str(json['refresh_token']),
    // 30s skew so we refresh slightly before the server would reject it.
    expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    scope: str(json['scope']),
  };
}

async function tokenRequest(
    base: string, params: Record<string, string>,
    fetchImpl: FetchLike): Promise<Tokens> {
  let res: HttpResponse;
  try {
    res = await fetchImpl(`${trimSlash(base)}/oauth/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    throw new CodaError('network', '로그인 서버에 연결할 수 없습니다.');
  }
  const json = await safeJson(res);
  // The server may answer OAuth errors with HTTP 200 and an `error` field.
  if (!res.ok || !json || !json['access_token']) {
    throw new CodaError(
        str(json?.['error']) || 'token_error',
        str(json?.['error_description']) || '토큰 발급에 실패했습니다.',
        {status: res.status});
  }
  return normalizeTokens(json);
}

export function exchangeCode(
    p: {
      base: string,
      clientId: string,
      redirectUri: string,
      code: string,
      verifier: string,
    },
    fetchImpl: FetchLike): Promise<Tokens> {
  return tokenRequest(p.base, {
    grant_type: 'authorization_code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code: p.code,
    code_verifier: p.verifier,
  }, fetchImpl);
}

/** Step 2 of login, called with the URL captured from the login tab. */
export function finishLogin(
    p: {
      base: string,
      clientId: string,
      callbackUrl: string,
      pending: PendingLogin,
    },
    fetchImpl: FetchLike): Promise<Tokens> {
  const code = parseAuthCallback(
      p.callbackUrl, p.pending.state, {redirectUri: p.pending.redirectUri});
  return exchangeCode(
      {
        base: p.base,
        clientId: p.clientId,
        redirectUri: p.pending.redirectUri,
        code,
        verifier: p.pending.verifier,
      },
      fetchImpl);
}

export function refreshTokens(
    p: {base: string, clientId: string, refreshToken: string},
    fetchImpl: FetchLike): Promise<Tokens> {
  return tokenRequest(p.base, {
    grant_type: 'refresh_token',
    client_id: p.clientId,
    refresh_token: p.refreshToken,
  }, fetchImpl);
}

/** Best effort: logout must succeed locally even if the server is down. */
export async function revokeToken(
    p: {base: string, token: string, hint?: string},
    fetchImpl: FetchLike): Promise<void> {
  const params: Record<string, string> = {token: p.token};
  if (p.hint) {
    params['token_type_hint'] = p.hint;
  }
  try {
    await fetchImpl(`${trimSlash(p.base)}/oauth/revoke`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    // ignored on purpose
  }
}

// ───────────────────────────── Gateway client ─────────────────────────────

export class GatewayClient {
  private base: string;
  private clientId: string;
  tokenStore: TokenStore;
  private fetchImpl: FetchLike;
  private refreshing: Promise<Tokens>|null = null;

  constructor(p: {
    base: string,
    clientId: string,
    tokenStore: TokenStore,
    fetchImpl: FetchLike,
  }) {
    this.base = trimSlash(p.base);
    this.clientId = p.clientId;
    this.tokenStore = p.tokenStore;
    this.fetchImpl = p.fetchImpl;
  }

  async accessToken(): Promise<string> {
    const t = await this.tokenStore.load();
    if (!t) {
      throw new CodaError('not_logged_in', '로그인이 필요합니다.');
    }
    if (t.expiresAt > Date.now()) {
      return t.accessToken;
    }
    return (await this.refresh(t)).accessToken;
  }

  refresh(current: Tokens|null): Promise<Tokens> {
    // Refresh tokens rotate: two parallel refreshes would burn the token and
    // log the user out, so all callers share one in-flight request.
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          if (!current || !current.refreshToken) {
            throw new CodaError('not_logged_in', '로그인이 필요합니다.');
          }
          const fresh = await refreshTokens(
              {
                base: this.base,
                clientId: this.clientId,
                refreshToken: current.refreshToken,
              },
              this.fetchImpl);
          await this.tokenStore.save(fresh);
          return fresh;
        } catch (e) {
          // Only a definitive rejection means the refresh token is dead. A
          // network error or a 5xx must NOT log the user out.
          if (e instanceof CodaError &&
              (e.code === 'invalid_grant' || e.code === 'invalid_client')) {
            await this.tokenStore.clear();
          }
          throw e;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async call<T>(
      name: string, method: string, body: object|null,
      opts: RequestOptions = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      const headers: Record<string, string> = {'Authorization': `Bearer ${token}`};
      if (body) {
        headers['Content-Type'] = 'application/json';
      }
      let res: HttpResponse;
      try {
        res = await this.fetchImpl(`${this.base}/wp-json/wpos/v1/coda/${name}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: opts.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw e;
        }
        throw new CodaError('network', 'CODA 서버에 연결할 수 없습니다.');
      }
      if (res.status === 401 && attempt === 0) {
        // Bad token although our clock said fresh (revoked / clock skew):
        // force one refresh, then retry once.
        await this.refresh(await this.tokenStore.load());
        continue;
      }
      const json = await safeJson(res);
      if (res.ok && json && json['ok'] === true) {
        return json['data'] as T;
      }
      throw new CodaError(
          str(json?.['code']) || `http_${res.status}`,
          str(json?.['message']) || 'CODA 요청에 실패했습니다.',
          {
            status: res.status,
            retryAfter: Number(res.headers.get('retry-after')) || 0,
          });
    }
    throw new CodaError('not_logged_in', '로그인이 필요합니다.');
  }

  status(opts?: RequestOptions) {
    return this.call<StatusData>('status', 'GET', null, opts);
  }

  chat(message: string, history: HistoryItem[] = [], opts?: RequestOptions) {
    return this.call<ChatData>('chat', 'POST', {message, history}, opts);
  }

  search(
      query: string, p: {topK?: number, minScore?: number} = {},
      opts?: RequestOptions) {
    return this.call<SearchData>(
        'search', 'POST',
        {query, top_k: p.topK ?? 5, min_score: p.minScore ?? 0.4}, opts);
  }

  summarize(text: string, maxSentences: number = 3, opts?: RequestOptions) {
    return this.call<SummarizeData>(
        'summarize', 'POST', {text, max_sentences: maxSentences}, opts);
  }
}

// ───────────────────────────── URL safety ─────────────────────────────

/**
 * String-level check for URLs that came out of a search result. The browser
 * process enforces the same rule again (SwanFetcher) and additionally blocks
 * requests whose *resolved* address is local (Local Network Access = block).
 */
export function isSafeWebUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (e) {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return false;
  }
  if (u.username || u.password) {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return false;
  }
  if (/\.(local|internal|lan|home|corp|intranet|home\.arpa)$/.test(host)) {
    return false;
  }
  if (!host.includes('.')) {
    return false;  // single-label intranet names
  }
  if (host.startsWith('[')) {
    return false;  // IPv6 literals: never for web results
  }
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) {
      return false;
    }
    if (a === 169 && b === 254) {
      return false;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return false;
    }
    if (a === 192 && b === 168) {
      return false;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return false;  // CGNAT
    }
    if (a >= 224) {
      return false;  // multicast / reserved
    }
  }
  return true;
}

// ───────────────────────────── Agent ─────────────────────────────

export interface AgentOptions {
  autoSearch: boolean;        // CODA corpus search (scope coda:search)
  maxSearchRounds: number;    // max /search calls per question
  minEvidenceScore: number;   // chat sources below this count as "no evidence"
  wantedEvidence: number;     // stop searching once this many accepted hits
  webSearch: boolean;         // browser-side web search; opt-in
  maxWebResults: number;
  maxWebPages: number;        // pages fetched + summarized per question
  maxPageChars: number;
}

export const DEFAULT_AGENT_OPTIONS: Readonly<AgentOptions> = Object.freeze({
  autoSearch: true,
  maxSearchRounds: 3,
  minEvidenceScore: 0.45,
  wantedEvidence: 3,
  webSearch: false,
  maxWebResults: 5,
  maxWebPages: 3,
  maxPageChars: 4000,
});

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/** Provided by the browser side (DuckDuckGoProvider over the fetch bridge). */
export interface WebProvider {
  search(query: string, opts: {count: number, signal?: AbortSignal}):
      Promise<WebResult[]>;
  fetchPageText(url: string, opts: {maxChars: number, signal?: AbortSignal}):
      Promise<string>;
}

export interface Evidence {
  text: string;
  score: number;
  query: string;
}

export interface WebItem extends WebResult {
  summary: string;
}

export interface AgentStep {
  kind: string;
  detail: string;
  at: number;
}

export type AnswerSource = 'chat'|'corpus'|'web'|'none';

export interface AgentResult {
  reply: string;
  path: string;
  answerSource: AnswerSource;
  sources: ChatSource[];
  evidence: Evidence[];
  web: {query: string, items: WebItem[]}|null;
  steps: AgentStep[];
}

const QUESTION_NOISE =
    /(알려\s*줘|알려\s*주세요|알려\s*줄래|뭐야|뭔가요|무엇인가요|어때|찾아\s*줘|검색해\s*줘|해\s*줘|해\s*주세요|궁금해|좀)/g;

/** Cheap, deterministic query rewrites (CODA cannot rewrite its own query). */
export function reformulate(question: string): string[] {
  const original = question.replace(/\s+/g, ' ').trim();
  const cleaned = original.replace(QUESTION_NOISE, ' ')
                      .replace(/[?？!！.~。]+/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
  const tokens = cleaned.split(' ').filter(t => t.length >= 2);
  const out: string[] = [original];
  if (cleaned && cleaned !== original) {
    out.push(cleaned);
  }
  if (tokens.length > 6) {
    out.push(tokens.slice(0, 6).join(' '));
  }
  return [...new Set(out)].filter(Boolean);
}

export interface GatewayLike {
  status(opts?: RequestOptions): Promise<StatusData>;
  chat(message: string, history?: HistoryItem[], opts?: RequestOptions):
      Promise<ChatData>;
  search(query: string, p?: {topK?: number, minScore?: number}, opts?: RequestOptions):
      Promise<SearchData>;
  summarize(text: string, maxSentences?: number, opts?: RequestOptions):
      Promise<SummarizeData>;
}

export class CodaAgent {
  private gateway: GatewayLike;
  private webProvider: WebProvider|null;
  opts: AgentOptions;

  constructor(
      gateway: GatewayLike,
      deps: {webProvider?: WebProvider|null, options?: Partial<AgentOptions>} = {}) {
    this.gateway = gateway;
    this.webProvider = deps.webProvider ?? null;
    this.opts = {...DEFAULT_AGENT_OPTIONS, ...deps.options};
  }

  /**
   * Answers one question. `steps` is a human-readable trace the UI shows
   * ("자동 검색 중…") so the user can see what CODA did on their behalf.
   */
  async ask(
      question: string,
      p: {history?: HistoryItem[], forceWeb?: boolean, signal?: AbortSignal} = {}):
      Promise<AgentResult> {
    const steps: AgentStep[] = [];
    const note = (kind: string, detail: string) =>
        steps.push({kind, detail, at: Date.now()});
    const signal = p.signal;
    const forceWeb = p.forceWeb ?? false;

    const status = await this.gateway.status({signal});
    const can = status.features || {};
    if (!status.configured) {
      throw new CodaError('not_configured', 'CODA 서비스가 아직 준비되지 않았습니다.');
    }
    if (!can.chat) {
      throw new CodaError('insufficient_scope', 'CODA 대화 권한이 없습니다.');
    }

    note('chat', question);
    const chat = await this.gateway.chat(question, p.history ?? [], {signal});
    const result: AgentResult = {
      reply: chat.reply,
      path: chat.path,
      answerSource: 'chat',
      sources: chat.sources ?? [],
      evidence: [],
      web: null,
      steps,
    };
    const answered = !forceWeb && this.hasEvidence(chat);

    // Step 2: autonomous corpus search
    if (!answered && this.opts.autoSearch && can.search) {
      const evidence = await this.corpusSearch(question, signal, note);
      if (evidence.length) {
        result.evidence = evidence;
        result.answerSource = 'corpus';
      }
    }

    // Step 3: browser-side web search (opt-in)
    const wantWeb = forceWeb || (!answered && result.evidence.length === 0);
    if (wantWeb && this.opts.webSearch && this.webProvider) {
      const web = await this.webSearch(question, !!can.summarize, signal, note);
      if (web.items.length) {
        result.web = web;
        result.answerSource = 'web';
      }
    }

    if (!answered && result.answerSource === 'chat' && chat.path === 'no-evidence') {
      result.answerSource = 'none';  // show CODA's honest "no evidence" reply
    }
    return result;
  }

  private hasEvidence(chat: ChatData): boolean {
    if (chat.path === 'no-evidence') {
      return false;
    }
    if (chat.path === 'faq' || chat.path === 'greeting') {
      return true;
    }
    const top = Math.max(0, ...(chat.sources ?? []).map(s => s.score || 0));
    return top >= this.opts.minEvidenceScore;
  }

  private async corpusSearch(
      question: string, signal: AbortSignal|undefined,
      note: (kind: string, detail: string) => number): Promise<Evidence[]> {
    const seen = new Set<string>();
    const hits: Evidence[] = [];
    const queries = reformulate(question).slice(0, this.opts.maxSearchRounds);
    for (const q of queries) {
      note('search', q);
      const data = await this.gateway.search(q, {topK: 5, minScore: 0.4}, {signal});
      for (const r of data.results ?? []) {
        if (r.accepted && !seen.has(r.text)) {
          seen.add(r.text);
          hits.push({text: r.text, score: r.score, query: q});
        }
      }
      if (hits.length >= this.opts.wantedEvidence) {
        break;
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  }

  private async webSearch(
      question: string, canSummarize: boolean, signal: AbortSignal|undefined,
      note: (kind: string, detail: string) => number):
      Promise<{query: string, items: WebItem[]}> {
    const provider = this.webProvider!;
    const variants = reformulate(question);
    const query = variants[variants.length - 1] ?? question;
    note('web-search', query);
    const found = await provider.search(query, {count: this.opts.maxWebResults, signal});

    const items: WebItem[] = [];
    for (const r of found) {
      if (items.length >= this.opts.maxWebPages) {
        break;
      }
      if (!isSafeWebUrl(r.url)) {
        note('web-skip', `차단된 주소: ${r.url}`);
        continue;
      }
      let summary = '';
      if (canSummarize) {
        try {
          note('web-read', r.url);
          const text = await provider.fetchPageText(
              r.url, {maxChars: this.opts.maxPageChars, signal});
          const clipped = (text || '').slice(0, this.opts.maxPageChars);
          if (clipped.trim()) {
            summary = (await this.gateway.summarize(clipped, 3, {signal})).summary;
          }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            throw e;
          }
          if (e instanceof CodaError && e.code === 'wpos_coda_rate_limited') {
            throw e;
          }
          note('web-error', `${r.url}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      items.push({
        title: r.title || r.url,
        url: r.url,
        snippet: r.snippet || '',
        summary,
      });
    }
    return {query, items};
  }
}
