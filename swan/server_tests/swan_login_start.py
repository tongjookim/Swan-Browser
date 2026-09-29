#!/usr/bin/env python3
"""Step 1 of the user-driven SWAN login E2E.

Creates PKCE + state, stores them locally (mode 600, never sent anywhere) and prints the
authorize URL. Open that URL in a browser where YOU are logged in to www.swn.kr as the
account under test and click "허용". The browser is then redirected to
http://127.0.0.1:53211/callback?code=...&state=... — the page will fail to load (nothing
listens there); copy the FULL URL from the address bar and pass it to swan_login_finish.py.

No server-side state is changed by this script.
"""
import base64, hashlib, json, os, secrets, sys
from urllib.parse import urlencode

BASE = 'https://www.swn.kr'
CLIENT_ID = 'client_db531dcad80b7a820b560b1c'      # "SWAN" public client (registered 2026-09-29)
REDIRECT = 'http://127.0.0.1:53211/callback'
SCOPE = 'basic profile coda:chat coda:search coda:page'
STATE_FILE = os.path.expanduser('~/.swan_login_pending.json')

verifier = secrets.token_urlsafe(32)                                   # 43 chars
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
state = secrets.token_urlsafe(16)

fd = os.open(STATE_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump({'verifier': verifier, 'state': state, 'redirect': REDIRECT}, f)

url = f'{BASE}/oauth/authorize?' + urlencode({
    'response_type': 'code', 'client_id': CLIENT_ID, 'redirect_uri': REDIRECT, 'scope': SCOPE,
    'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'})
print(url)
print('\n1) 위 URL을 로그인된 브라우저에서 열고 [허용]을 누르세요 (10분 안에).', file=sys.stderr)
print('2) 이동된 주소(http://127.0.0.1:53211/callback?code=...)를 통째로 복사하세요.', file=sys.stderr)
print('3) python3 swan_login_finish.py "<복사한 URL>"', file=sys.stderr)
