// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// SWAN's page talks to a small hand-written message handler (SwanHandler), not a Mojo
// PageHandler; sendWithPromise is the matching legacy transport.
// eslint-disable-next-line no-restricted-imports
import {sendWithPromise} from 'chrome://resources/js/cr.js';

/**
 * Everything that touches the network or the OS goes through the browser
 * process (SwanHandler). The page itself has `connect-src 'none'`.
 */
export type FetchMode = 'swn'|'web';

export interface FetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  mode: FetchMode;
  maxBytes: number;
}

export interface FetchResult {
  /** HTTP status, 0 when the request failed before a response. */
  status: number;
  /** Non-empty when the browser process refused or failed the request. */
  error: string;
  /** Lower-cased names; only content-type and retry-after are forwarded. */
  headers: Record<string, string>;
  body: string;
}

export interface SwanSettings {
  autoSearch: boolean;
  webSearch: boolean;
  pageContext: boolean;
}

export interface BrowserProxy {
  tokenLoad(): Promise<string|null>;
  tokenSave(json: string): Promise<boolean>;
  tokenClear(): Promise<void>;
  getSettings(): Promise<SwanSettings>;
  setSetting(key: keyof SwanSettings, value: boolean): Promise<void>;
  fetch(request: FetchRequest): Promise<FetchResult>;
  /** Opens the login tab. Resolves with the intercepted callback URL. */
  loginStart(authorizeUrl: string): Promise<string>;
  /** Text of the active tab (only when the user enabled page context). */
  getActiveTabText(): Promise<ActiveTabText>;
}

export interface ActiveTabText {
  url: string;
  title: string;
  text: string;
}

export class BrowserProxyImpl implements BrowserProxy {
  tokenLoad() {
    return sendWithPromise<string|null>('swanTokenLoad');
  }

  tokenSave(json: string) {
    return sendWithPromise<boolean>('swanTokenSave', json);
  }

  tokenClear() {
    return sendWithPromise<void>('swanTokenClear');
  }

  getSettings() {
    return sendWithPromise<SwanSettings>('swanGetSettings');
  }

  setSetting(key: keyof SwanSettings, value: boolean) {
    return sendWithPromise<void>('swanSetSetting', key, value);
  }

  fetch(request: FetchRequest) {
    return sendWithPromise<FetchResult>('swanFetch', request);
  }

  loginStart(authorizeUrl: string) {
    return sendWithPromise<string>('swanLoginStart', authorizeUrl);
  }

  getActiveTabText() {
    return sendWithPromise<ActiveTabText>('swanGetActiveTabText');
  }

  static getInstance(): BrowserProxy {
    return instance || (instance = new BrowserProxyImpl());
  }

  static setInstance(obj: BrowserProxy) {
    instance = obj;
  }
}

let instance: BrowserProxy|null = null;
