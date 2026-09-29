// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/** Server that provides OAuth (wp-oauth-server >= 1.2.0) and the CODA gateway. */
export const SWAN_BASE = 'https://www.swn.kr';

/**
 * Public OAuth client "SWAN" (PKCE S256, no secret). The redirect URI is
 * registered on the server as the portless loopback URI
 * `http://127.0.0.1/callback`; the browser intercepts that navigation inside
 * the login tab, so no local port is ever opened.
 */
export const SWAN_CLIENT_ID = 'client_db531dcad80b7a820b560b1c';

export const SWAN_SCOPE = 'basic profile coda:chat coda:search coda:page';

/** Loopback port put into the redirect URI (never listened on). */
export const SWAN_LOOPBACK_PORT = 53211;
