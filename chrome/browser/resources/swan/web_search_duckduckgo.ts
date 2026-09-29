// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// DuckDuckGo web-search provider for CodaAgent.
//
// Uses the JavaScript-free endpoint https://html.duckduckgo.com/html/ so no
// API key is needed and the *user's browser* performs the search from the
// user's own IP. The parser is written against real markup (fixture:
// testdata/ddg_results_real.html, captured 2026-09-29).
//
// `fetchText` is injected and MUST be the browser-process bridge in mode
// 'web': cookie-less, size-capped, redirects/addresses checked (SwanFetcher).
//
// Known fragility: HTML scraping. If DuckDuckGo changes its markup or asks for
// a bot check, both are reported as errors instead of empty results.

import {CodaError, isSafeWebUrl} from './coda_client.js';
import type {WebProvider, WebResult} from './coda_client.js';

const MAX_QUERY_CHARS = 200;

export type FetchText = (url: string, opts: {signal?: AbortSignal}) =>
    Promise<string>;

export function buildDuckDuckGoUrl(
    query: string, opts: {region?: string} = {}): string {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
  const params = new URLSearchParams({q, kl: opts.region ?? 'kr-kr'});
  return `https://html.duckduckgo.com/html/?${params}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, e: string) => {
        if (e.startsWith('#')) {
          const cp = e.charAt(1).toLowerCase() === 'x' ?
              parseInt(e.slice(2), 16) :
              parseInt(e.slice(1), 10);
          return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : match;
        }
        return NAMED_ENTITIES[e.toLowerCase()] ?? match;
      });
}

// Tags are stripped BEFORE entities are decoded, so an escaped "&lt;script&gt;"
// in a title stays literal text and can never become markup.
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** DuckDuckGo wraps every result in //duckduckgo.com/l/?uddg=<real url>. */
export function resolveResultUrl(href: string): string|null {
  let u: URL;
  try {
    u = new URL(decodeEntities(href), 'https://duckduckgo.com/');
  } catch (e) {
    return null;
  }
  let target = u;
  if (u.hostname === 'duckduckgo.com' || u.hostname.endsWith('.duckduckgo.com')) {
    const uddg = u.pathname === '/l/' ? u.searchParams.get('uddg') : null;
    if (!uddg) {
      return null;  // DuckDuckGo-internal link, not a result
    }
    try {
      target = new URL(uddg);
    } catch (e) {
      return null;
    }
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return null;
  }
  return target.href;
}

/**
 * Parses a html.duckduckgo.com results page into [{title, url, snippet}].
 * Ads are skipped. Throws CodaError('search_blocked') on a bot check and
 * CodaError('search_parse') when the page looks like a results page but
 * nothing could be extracted (markup changed).
 */
export function parseDuckDuckGoHtml(
    html: string, opts: {max?: number} = {}): WebResult[] {
  const max = opts.max ?? 10;
  if (/anomaly-modal|anomaly\.js|bots use DuckDuckGo too/i.test(html)) {
    throw new CodaError(
        'search_blocked',
        '검색 엔진이 자동 요청 확인을 요구했습니다. 잠시 후 다시 시도하세요.');
  }
  const results: WebResult[] = [];
  const seen = new Set<string>();
  const block =
      /<div class="(result results_links[^"]*)"[^>]*>([\s\S]*?)<div class="clear"><\/div>/g;
  let m: RegExpExecArray|null;
  while ((m = block.exec(html)) && results.length < max) {
    const cls = m[1] ?? '';
    const body = m[2] ?? '';
    if (/\bresult--ad\b/.test(cls)) {
      continue;
    }
    const titleTag = body.match(
        /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b)[^>]*>([\s\S]*?)<\/a>/);
    if (!titleTag) {
      continue;
    }
    const href = (titleTag[0] ?? '').match(/\bhref="([^"]*)"/);
    const url = href && href[1] !== undefined ? resolveResultUrl(href[1]) : null;
    if (!url || seen.has(url)) {
      continue;
    }
    const snip = body.match(
        /<(a|div)\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b)[^>]*>([\s\S]*?)<\/\1>/);
    seen.add(url);
    results.push({
      title: stripTags(titleTag[1] ?? '') || url,
      url,
      snippet: snip ? stripTags(snip[2] ?? '') : '',
    });
  }
  if (results.length === 0 && /class="result\b/.test(html)) {
    throw new CodaError(
        'search_parse',
        '검색 결과 형식을 해석하지 못했습니다(검색 엔진 페이지 구조 변경).');
  }
  return results;
}

/**
 * Crude readable-text extraction for result pages. Good enough as input to
 * CODA's extractive summarizer; not a general readability implementation.
 */
export function htmlToText(html: string, opts: {maxChars?: number} = {}): string {
  const maxChars = opts.maxChars ?? 4000;
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
              .replace(
                  /<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi,
                  ' ');
  // Prefer the main article body when the page has one.
  const main = s.match(/<article\b[\s\S]*?<\/article>/i) ||
      s.match(/<main\b[\s\S]*?<\/main>/i);
  if (main && main[0] && stripTags(main[0]).length >= 200) {
    s = main[0];
  }
  s = s.replace(/<(nav|header|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ')
          .replace(
              /<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi,
              '\n');
  const lines = decodeEntities(s.replace(/<[^>]*>/g, ' '))
                    .split('\n')
                    .map(l => l.replace(/\s+/g, ' ').trim())
                    .filter(l => l.length > 0);
  return lines.join('\n').slice(0, maxChars);
}

// ── Provider (implements CodaAgent's WebProvider interface) ──

export class DuckDuckGoProvider implements WebProvider {
  private fetchText: FetchText;
  private region: string;

  constructor(p: {fetchText: FetchText, region?: string}) {
    this.fetchText = p.fetchText;
    this.region = p.region ?? 'kr-kr';
  }

  async search(query: string, opts: {count: number, signal?: AbortSignal}):
      Promise<WebResult[]> {
    const html = await this.fetchText(
        buildDuckDuckGoUrl(query, {region: this.region}), {signal: opts.signal});
    return parseDuckDuckGoHtml(html, {max: opts.count});
  }

  async fetchPageText(
      url: string, opts: {maxChars: number, signal?: AbortSignal}): Promise<string> {
    if (!isSafeWebUrl(url)) {
      throw new CodaError('unsafe_url', '읽을 수 없는 주소입니다.');
    }
    return htmlToText(
        await this.fetchText(url, {signal: opts.signal}),
        {maxChars: opts.maxChars});
  }
}
