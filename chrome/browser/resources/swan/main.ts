// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// chrome://swan — SWAN's CODA panel: login, chat, automatic search, opt-in web
// search. Every string that comes from the server or from the web is rendered
// with textContent only.

import {BrowserProxyImpl} from './browser_proxy.js';
import type {FetchMode, SwanSettings} from './browser_proxy.js';
import {SWAN_BASE, SWAN_CLIENT_ID, SWAN_LOOPBACK_PORT, SWAN_SCOPE} from './config.js';
import {CodaAgent, CodaError, finishLogin, GatewayClient, isSafeWebUrl, revokeToken, startLogin} from './coda_client.js';
import type {AgentResult, FetchLike, HistoryItem, HttpResponse, Tokens, TokenStore} from './coda_client.js';
import {DuckDuckGoProvider} from './web_search_duckduckgo.js';

const proxy = BrowserProxyImpl.getInstance();

// ───────────────────────────── plumbing ─────────────────────────────

/** All network traffic goes through the browser process. */
function bridgeFetch(mode: FetchMode, maxBytes: number): FetchLike {
  return async (url, init) => {
    const r = await proxy.fetch({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ?? '',
      mode,
      maxBytes,
    });
    if (r.error) {
      throw new Error(r.error);
    }
    const res: HttpResponse = {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: {get: (name: string) => r.headers[name.toLowerCase()] ?? null},
      json: () => Promise.resolve(JSON.parse(r.body) as unknown),
      text: () => Promise.resolve(r.body),
    };
    return res;
  };
}

const swnFetch = bridgeFetch('swn', 200_000);
const webFetch = bridgeFetch('web', 1_500_000);

class BrowserTokenStore implements TokenStore {
  async load(): Promise<Tokens|null> {
    const raw = await proxy.tokenLoad();
    if (!raw) {
      return null;
    }
    try {
      const v = JSON.parse(raw) as Partial<Tokens>;
      if (typeof v.accessToken === 'string' &&
          typeof v.refreshToken === 'string' &&
          typeof v.expiresAt === 'number' && typeof v.scope === 'string') {
        return {
          accessToken: v.accessToken,
          refreshToken: v.refreshToken,
          expiresAt: v.expiresAt,
          scope: v.scope,
        };
      }
    } catch (e) {
      // fall through: treat a corrupt store as logged out
    }
    return null;
  }

  async save(tokens: Tokens): Promise<void> {
    await proxy.tokenSave(JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    await proxy.tokenClear();
  }
}

const tokenStore = new BrowserTokenStore();
const gateway = new GatewayClient({
  base: SWAN_BASE,
  clientId: SWAN_CLIENT_ID,
  tokenStore,
  fetchImpl: swnFetch,
});

const webProvider = new DuckDuckGoProvider({
  fetchText: async (url: string) => {
    const res = await webFetch(url);
    if (!res.ok) {
      throw new CodaError(`http_${res.status}`, `페이지를 불러오지 못했습니다 (${res.status}).`);
    }
    return res.text();
  },
});

// ───────────────────────────── DOM helpers ─────────────────────────────

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`missing element #${id}`);
  }
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

function errorMessage(e: unknown): string {
  if (e instanceof CodaError) {
    if (e.code === 'wpos_coda_rate_limited' || e.code === 'wpos_coda_quota_exceeded') {
      return e.retryAfter ?
          `요청이 많습니다. ${e.retryAfter}초 후 다시 시도하세요.` :
          e.message;
    }
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'string') {
    return e === 'cancelled' ? '로그인이 취소되었습니다.' :
        e === 'timeout'      ? '로그인 시간이 초과되었습니다.' :
                               e;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

let noticeTimer = 0;
function notify(message: string) {
  const n = $('notice');
  n.textContent = message;
  n.hidden = !message;
  window.clearTimeout(noticeTimer);
  if (message) {
    noticeTimer = window.setTimeout(() => notify(''), 8000);
  }
}

// ───────────────────────────── state ─────────────────────────────

let settings: SwanSettings = {autoSearch: true, webSearch: false, pageContext: false};
let userName = '';
let canSummarize = false;
const history: HistoryItem[] = [];
let busy = false;

function makeAgent(): CodaAgent {
  return new CodaAgent(gateway, {
    webProvider,
    options: {autoSearch: settings.autoSearch, webSearch: settings.webSearch},
  });
}

// ───────────────────────────── account ─────────────────────────────

async function refreshAccount(): Promise<void> {
  const tokens = await tokenStore.load();
  if (!tokens) {
    showSignedOut();
    return;
  }
  try {
    const st = await gateway.status();
    userName = st.user ?? '';
    canSummarize = !!st.features.summarize;
    if (!st.configured) {
      notify('CODA 서비스가 아직 준비되지 않았습니다.');
    }
    showChat();
  } catch (e) {
    if (e instanceof CodaError && e.code === 'not_logged_in') {
      showSignedOut();
    } else {
      showSignedOut();
      notify(errorMessage(e));
    }
  }
}

function showSignedOut() {
  $('signedOut').hidden = false;
  $('chat').hidden = true;
  $('account').textContent = '';
}

function showChat() {
  $('signedOut').hidden = true;
  $('chat').hidden = false;
  const account = $('account');
  account.textContent = '';
  account.append(el('span', 'user', userName ? `${userName} 님` : '로그인됨'));
  const out = el('button', 'link', '로그아웃');
  out.addEventListener('click', () => void logout());
  account.append(out);
  ($<HTMLButtonElement>('summarizePage')).hidden = !settings.pageContext || !canSummarize;
  ($<HTMLInputElement>('input')).focus();
}

async function login(): Promise<void> {
  const btn = $<HTMLButtonElement>('loginBtn');
  btn.disabled = true;
  notify('');
  try {
    const {authorizeUrl, pending} = await startLogin({
      base: SWAN_BASE,
      clientId: SWAN_CLIENT_ID,
      scope: SWAN_SCOPE,
      port: SWAN_LOOPBACK_PORT,
    });
    // Opens a login tab; resolves with the intercepted loopback callback URL.
    const callbackUrl = await proxy.loginStart(authorizeUrl);
    const tokens = await finishLogin(
        {base: SWAN_BASE, clientId: SWAN_CLIENT_ID, callbackUrl, pending}, swnFetch);
    await tokenStore.save(tokens);
    await refreshAccount();
  } catch (e) {
    notify(errorMessage(e));
  } finally {
    btn.disabled = false;
  }
}

async function logout(): Promise<void> {
  const tokens = await tokenStore.load();
  if (tokens) {
    await revokeToken({base: SWAN_BASE, token: tokens.accessToken}, swnFetch);
    if (tokens.refreshToken) {
      await revokeToken(
          {base: SWAN_BASE, token: tokens.refreshToken, hint: 'refresh_token'}, swnFetch);
    }
  }
  await tokenStore.clear();
  history.length = 0;
  $('messages').textContent = '';
  userName = '';
  showSignedOut();
}

// ───────────────────────────── chat rendering ─────────────────────────────

function addMessage(role: 'user'|'assistant', text?: string): HTMLElement {
  const box = el('div', `msg ${role}`);
  if (text !== undefined) {
    box.append(el('p', 'text', text));
  }
  const list = $('messages');
  list.append(box);
  box.scrollIntoView({block: 'end'});
  return box;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function renderResult(box: HTMLElement, r: AgentResult, question: string) {
  box.textContent = '';
  box.append(el('p', 'text', r.reply));

  if (r.answerSource === 'none') {
    box.append(el('p', 'hint', '학습된 자료에서 근거를 찾지 못했습니다.'));
  }

  if (r.evidence.length) {
    const sec = el('section', 'evidence');
    sec.append(el('h3', '', '관련 자료 (자동 검색)'));
    const ul = el('ul');
    for (const e of r.evidence) {
      ul.append(el('li', '', `${e.text}  · ${(e.score * 100).toFixed(0)}%`));
    }
    sec.append(ul);
    box.append(sec);
  }

  if (r.web) {
    const sec = el('section', 'web');
    sec.append(el('h3', '', `웹 검색 결과 (DuckDuckGo · "${r.web.query}")`));
    for (const item of r.web.items) {
      const card = el('div', 'card');
      const title = el('a', 'title', item.title);
      // Never turn an unsafe URL into a link.
      if (isSafeWebUrl(item.url)) {
        title.setAttribute('href', item.url);
        title.setAttribute('target', '_blank');
        title.setAttribute('rel', 'noopener noreferrer');
      }
      card.append(title, el('div', 'host', hostOf(item.url)));
      if (item.summary) {
        card.append(el('p', 'summary', item.summary));
      } else if (item.snippet) {
        card.append(el('p', 'snippet', item.snippet));
      }
      sec.append(card);
    }
    if (!canSummarize) {
      sec.append(el('p', 'hint', '페이지 요약 권한(coda:page)이 없어 검색 결과만 표시합니다.'));
    }
    box.append(sec);
  }

  if (!r.web && settings.webSearch) {
    const more = el('button', 'link', '웹에서 검색');
    more.addEventListener('click', () => void send(question, true));
    box.append(more);
  }

  if (r.steps.length > 1) {
    const details = el('details', 'steps');
    details.append(el('summary', '', `CODA가 수행한 작업 (${r.steps.length})`));
    const ul = el('ul');
    for (const s of r.steps) {
      ul.append(el('li', '', `${s.kind}: ${s.detail}`));
    }
    details.append(ul);
    box.append(details);
  }
}

async function send(text: string, forceWeb = false): Promise<void> {
  const question = text.trim();
  if (!question || busy) {
    return;
  }
  busy = true;
  addMessage('user', question);
  const box = addMessage('assistant');
  box.classList.add('pending');
  box.append(el('p', 'text', forceWeb ? '웹에서 검색하는 중…' : '생각하는 중…'));
  try {
    const result = await makeAgent().ask(
        question, {history: history.slice(-5), forceWeb});
    box.classList.remove('pending');
    renderResult(box, result, question);
    history.push({role: 'user', content: question});
    history.push({role: 'assistant', content: result.reply});
  } catch (e) {
    box.classList.remove('pending');
    box.classList.add('error');
    box.textContent = '';
    box.append(el('p', 'text', errorMessage(e)));
    if (e instanceof CodaError && e.code === 'not_logged_in') {
      showSignedOut();
    }
  } finally {
    busy = false;
  }
}

async function summarizeActivePage(): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  const box = addMessage('assistant');
  box.classList.add('pending');
  box.append(el('p', 'text', '현재 페이지를 읽는 중…'));
  try {
    const page = await proxy.getActiveTabText();
    const text = page.text.slice(0, 4000);
    if (!text.trim()) {
      throw new CodaError('empty_page', '이 페이지에서 읽을 수 있는 내용이 없습니다.');
    }
    const s = await gateway.summarize(text, 3);
    box.classList.remove('pending');
    box.textContent = '';
    box.append(el('p', 'text', s.summary));
    box.append(el('p', 'hint', `${page.title || hostOf(page.url)} (${hostOf(page.url)}) · 본문 ${text.length}자를 요약을 위해 서버로 전송했습니다.`));
  } catch (e) {
    box.classList.remove('pending');
    box.classList.add('error');
    box.textContent = '';
    box.append(el('p', 'text', errorMessage(e)));
  } finally {
    busy = false;
  }
}

// ───────────────────────────── settings ─────────────────────────────

function bindSetting(id: string, key: keyof SwanSettings) {
  const box = $<HTMLInputElement>(id);
  box.checked = settings[key];
  box.addEventListener('change', async () => {
    settings = {...settings, [key]: box.checked};
    await proxy.setSetting(key, box.checked);
    ($<HTMLButtonElement>('summarizePage')).hidden =
        !settings.pageContext || !canSummarize;
  });
}

// ───────────────────────────── init ─────────────────────────────

async function init() {
  $('loginBtn').addEventListener('click', () => void login());
  $('form').addEventListener('submit', (ev: Event) => {
    ev.preventDefault();
    const input = $<HTMLInputElement>('input');
    const text = input.value;
    input.value = '';
    void send(text);
  });
  $('summarizePage').addEventListener('click', () => void summarizeActivePage());
  settings = await proxy.getSettings();
  bindSetting('optAutoSearch', 'autoSearch');
  bindSetting('optWebSearch', 'webSearch');
  bindSetting('optPageContext', 'pageContext');
  await refreshAccount();
}

void init();
