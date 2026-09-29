#!/usr/bin/env python3
"""Step 2 of the user-driven SWAN login E2E: exchange the code the USER authorised, then exercise the
gateway with that real user token, then clean up everything this run created.

usage: python3 swan_login_finish.py "<callback url copied from the browser>" [--keep]
"""
import json, os, subprocess, sys, tempfile
from urllib.parse import parse_qs, urlparse
import requests

BASE = 'https://www.swn.kr'
CLIENT_ID = 'client_db531dcad80b7a820b560b1c'
STATE_FILE = os.path.expanduser('~/.swan_login_pending.json')
G = f'{BASE}/wp-json/wpos/v1/coda'
results = []


def check(name, cond, detail=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'   <-- {detail}'))


if len(sys.argv) < 2:
    sys.exit(__doc__)
pending = json.load(open(STATE_FILE))
cb = urlparse(sys.argv[1])
q = parse_qs(cb.query)
origin_ok = f'{cb.scheme}://{cb.hostname}'.startswith('http://127.0.0.1') and cb.path == '/callback'
state_ok = q.get('state', [''])[0] == pending['state']
check('callback origin/path matches the registered loopback redirect', origin_ok, sys.argv[1][:80])
check('state matches (CSRF)', state_ok, q.get('state'))
if not (origin_ok and state_ok):
    sys.exit('refusing to use this callback: nothing was sent to the server')   # abort BEFORE any exchange
if 'error' in q:
    sys.exit(f"authorize returned error: {q['error']} {q.get('error_description', '')}")
if 'code' not in q:
    sys.exit('callback has no code')
code = q['code'][0]

# ── token exchange: verifier, NO client_secret ──
t = requests.post(f'{BASE}/oauth/token', timeout=30, data={
    'grant_type': 'authorization_code', 'client_id': CLIENT_ID, 'code': code,
    'redirect_uri': pending['redirect'], 'code_verifier': pending['verifier']}).json()
check('code exchange with PKCE verifier (no secret)', 'access_token' in t and 'refresh_token' in t, t)
if 'access_token' not in t:
    sys.exit(1)
scopes = set(t['scope'].split())
check('granted scopes include all coda:* + profile', {'coda:chat', 'coda:search', 'coda:page', 'profile'} <= scopes, t['scope'])
os.remove(STATE_FILE)                                                   # verifier is single use

H = {'Authorization': f"Bearer {t['access_token']}", 'Content-Type': 'application/json'}
ui = requests.get(f'{BASE}/oauth/userinfo', headers=H, timeout=30).json()
# only non-sensitive fields are printed
print('   userinfo:', {k: ui.get(k) for k in ('login', 'name', 'roles')})
check('userinfo returns the consenting user', bool(ui.get('sub')) and bool(ui.get('login')), ui)

# ── gateway with a REAL user token ──
r = requests.get(f'{G}/status', headers=H, timeout=30)
st = r.json().get('data', {})
check('status: configured, all three features on, user name present',
      r.status_code == 200 and st.get('configured') is True and st.get('features') == {'chat': True, 'search': True, 'summarize': True}
      and bool(st.get('user')), r.text[:200])

r = requests.post(f'{G}/chat', headers=H, timeout=60, data=json.dumps({'message': '안녕', 'user': 'spoofed-name', 'history': []}))
d = r.json().get('data', {})
check('chat -> real CODA reply', r.status_code == 200 and bool(d.get('reply')) and 'path' in d, r.text[:200])
print('   chat:', d.get('path'), '|', (d.get('reply') or '')[:50])
check("chat greeting uses the token owner's name, not the spoofed 'user' field", 'spoofed-name' not in json.dumps(d, ensure_ascii=False), d)

r = requests.post(f'{G}/search', headers=H, timeout=60, data=json.dumps({'query': '위기청소년 지원 사업', 'top_k': 3}))
d = r.json().get('data', {})
check('search -> real corpus results', r.status_code == 200 and len(d.get('results', [])) > 0, r.text[:200])

r = requests.post(f'{G}/summarize', headers=H, timeout=60, data=json.dumps({
    'text': '수완뉴스는 오늘 청소년 지원 사업을 확대한다고 발표했다. 이번 사업은 위기 청소년에게 생활비를 지원한다. 회사 관계자는 날씨가 좋다고 말했다.',
    'max_sentences': 2}))
check('summarize -> real summary', r.status_code == 200 and bool(r.json().get('data', {}).get('summary')), r.text[:200])

for name in ('ingest', 'ingest/flush', 'ingest/remove', 'article'):
    r = requests.post(f'{G}/{name}', headers=H, data='{}', timeout=30)
    check(f'/coda/{name} not exposed even to a fully-scoped real user token (404)', r.status_code == 404, r.status_code)
r = requests.get(f"{G}/status?access_token={t['access_token']}", timeout=30)
check('token in query string rejected', r.status_code == 401, r.status_code)

# ── refresh rotation with the real user token ──
r2 = requests.post(f'{BASE}/oauth/token', timeout=30, data={'grant_type': 'refresh_token', 'client_id': CLIENT_ID, 'refresh_token': t['refresh_token']}).json()
check('refresh (no secret) rotates tokens', 'access_token' in r2 and r2.get('refresh_token') != t['refresh_token'], r2)
d = requests.post(f'{BASE}/oauth/token', timeout=30, data={'grant_type': 'refresh_token', 'client_id': CLIENT_ID, 'refresh_token': t['refresh_token']}).json()
check('old refresh token cannot be reused', d.get('error') == 'invalid_grant', d)
H2 = {'Authorization': f"Bearer {r2['access_token']}"}
check('new access token works on the gateway', requests.get(f'{G}/status', headers=H2, timeout=30).status_code == 200)

# ── revoke ──
for tok in (t['access_token'], r2['access_token']):
    requests.post(f'{BASE}/oauth/revoke', data={'token': tok}, timeout=30)
requests.post(f'{BASE}/oauth/revoke', data={'token': r2['refresh_token'], 'token_type_hint': 'refresh_token'}, timeout=30)
check('after revoke the gateway rejects the token (401)', requests.get(f'{G}/status', headers=H2, timeout=30).status_code == 401)

# ── cleanup: ONLY rows for the SWAN client (other apps' consents of this user are untouched) ──
if '--keep' not in sys.argv:
    php = f"""<?php global $wpdb; $p=$wpdb->prefix; $c='{CLIENT_ID}';
    foreach (['oauth_access_tokens','oauth_refresh_tokens','oauth_authorization_codes','oauth_user_consents'] as $t) $wpdb->delete("{{$p}}$t", ['client_id'=>$c]);
    $wpdb->delete("{{$p}}oauth_logs", ['client_id'=>$c]);
    echo "cleaned SWAN client rows\\n";"""
    with tempfile.NamedTemporaryFile('w', suffix='.php', delete=False) as f:
        f.write(php)
    p = subprocess.run(['wp', '--allow-root', '--skip-plugins=cosmosfarm-members-google-login', 'eval-file', f.name],
                       cwd='/home/suwannews/www', capture_output=True, text=True, timeout=120)
    os.unlink(f.name)
    check('cleanup of SWAN client tokens/consent/logs', 'cleaned' in p.stdout, p.stdout + p.stderr)

print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
