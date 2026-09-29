#!/usr/bin/env python3
"""Runs the REAL gateway class against a local mock CODA upstream and asserts on both sides."""
import json, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import os
SP = os.path.dirname(os.path.abspath(__file__))
captured = []


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        captured.append({'path': self.path, 'auth': self.headers.get('Authorization'),
                         'ctype': self.headers.get('Content-Type'), 'body': body})
        msg = body.get('message', '')
        if msg == '__UPSTREAM_DROP__':
            self.connection.close(); return
        if msg == '__UPSTREAM_401__':
            return self._send(401, {'ok': False, 'error': {'code': 'unauthorized', 'message': 'SECRET-INTERNAL-DETAIL'}})
        if msg == '__UPSTREAM_ERROR__':
            return self._send(500, {'ok': False, 'error': {'code': 'engine_error', 'message': 'Traceback /home/robots/secret'}})
        if msg == '__UPSTREAM_HTML__':
            self.send_response(502); self.send_header('Content-Type', 'text/html'); self.end_headers()
            self.wfile.write(b'<html>bad gateway http://10.0.0.5:8510</html>'); return
        self._send(200, {'ok': True, 'data': {'echo_path': self.path, 'reply': 'ok'}})

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(raw)


srv = HTTPServer(('127.0.0.1', 0), Mock)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

p = subprocess.run(['php', f'{SP}/gw_harness.php', str(port)], capture_output=True, text=True, timeout=120)
line = [l for l in p.stdout.splitlines() if l.startswith('{"results"')]
if not line:
    print('HARNESS OUTPUT:\n', p.stdout[-2000:], p.stderr[-2000:]); sys.exit(2)
out = json.loads(line[-1])
R = {r['name']: r for r in out['results']}
stderr = p.stderr

res = []
def check(name, cond, detail=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'   <-- {detail}'))
def code(n): return (R[n]['status'], R[n].get('code'))

# not configured
check('K1 no API key -> 503 not_configured', code('nokey.chat') == (503, 'wpos_coda_not_configured'), R['nokey.chat'])
check('K2 status reports configured=false without key', R['nokey.status']['data']['configured'] is False, R['nokey.status'])
check('K3 nothing was sent upstream before the key existed', all(c['auth'] == 'Bearer SECRET_GATEWAY_KEY' for c in captured))

# authn / authz
check('A1 no token -> 401', code('auth.notoken') == (401, 'wpos_coda_no_token'), R['auth.notoken'])
check('A2 expired token -> 401', code('auth.expired') == (401, 'wpos_coda_invalid_token'), R['auth.expired'])
check('A3 user-less (client_credentials) token -> 403', code('auth.nouser') == (403, 'wpos_coda_user_required'), R['auth.nouser'])
check('A4 token of a deleted user -> 401', code('auth.ghostuser') == (401, 'wpos_coda_invalid_token'), R['auth.ghostuser'])
check('S1 token lacks scope -> 403', code('scope.tokenlacks') == (403, 'wpos_coda_insufficient_scope'), R['scope.tokenlacks'])
check("S2 admin did not allow scope for the client (user consented) -> 403", code('scope.clientlacks') == (403, 'wpos_coda_insufficient_scope'), R['scope.clientlacks'])
check('S3 search/summarize enforce their own scopes', code('scope.search_tokenlacks')[0] == 403 and code('scope.summarize_tokenlacks')[0] == 403)
sf = R['status.full']['data']
check('S4 status: all features on for full token', sf['features'] == {'chat': True, 'search': True, 'summarize': True} and sf['configured'] is True and sf['user'] == '홍길동', sf)
check('S5 status: features follow token AND client scope', R['status.limited']['data']['features'] == {'chat': False, 'search': False, 'summarize': False}
      and R['status.basic']['data']['features'] == {'chat': False, 'search': False, 'summarize': False}, (R['status.limited'], R['status.basic']))
check('S6 responses are Cache-Control: no-store', R['status.full'].get('cache') == 'no-store' and R['chat.ok'].get('cache') == 'no-store')

# validation
check('V1 invalid JSON -> 400', code('chat.badjson') == (400, 'wpos_coda_bad_json'), R['chat.badjson'])
check('V2 missing / non-string / blank message -> 422', all(code(n) == (422, 'wpos_coda_missing_message') for n in ('chat.missing', 'chat.nonstring', 'chat.blank')),
      [R[n] for n in ('chat.missing', 'chat.nonstring', 'chat.blank')])
check('V3 missing query / text -> 422', code('search.missing') == (422, 'wpos_coda_missing_query') and code('summ.missing') == (422, 'wpos_coda_missing_text'))
check('V4 summarize > 6000 chars -> 413, exactly 6000 ok', code('summ.toolong') == (413, 'wpos_coda_text_too_long') and R['summ.exact']['status'] == 200, (R['summ.toolong'], R['summ.exact']['status']))

by_path = lambda p: [c for c in captured if c['path'] == p]
chat = next(c for c in by_path('/v1/chat') if c['body'].get('message', '').startswith('안녕하세요'))
check('F1 forwarded with the SERVER key, JSON content-type', chat['auth'] == 'Bearer SECRET_GATEWAY_KEY' and 'application/json' in chat['ctype'], chat)
check("F2 'user' comes from the token owner, not the request (spoof 'admin' ignored)", chat['body']['user'] == '홍길동', chat['body'])
check('F3 only whitelisted fields forwarded (flush/x dropped)', set(chat['body']) == {'message', 'user', 'history'}, chat['body'])
check('F4 control chars stripped and whitespace collapsed', chat['body']['message'] == '안녕하세요 반갑습니다', repr(chat['body']['message']))
h = chat['body']['history']
# input had 9 entries; the last 5 are [empty-user, h3, h4, h5, 1500-char assistant] -> empty one dropped
check('F5 history: only the last 5 raw entries considered; empty dropped; earlier "system" injection never forwarded',
      [(x['role'], x['content'][:2]) for x in h] == [('user', 'h3'), ('assistant', 'h4'), ('user', 'h5'), ('assistant', '가가')]
      and not any('IGNORE' in x['content'] for x in h), h)
check('F6 history content capped at exactly 1000 chars', [len(x['content']) for x in h] == [2, 2, 2, 1000], [len(x['content']) for x in h])
srch = by_path('/v1/search')
s1 = next(c for c in srch if len(c['body']['query']) > 100)
check('F7 search: query capped 300, top_k clamped to 10, min_score clamped to 0, extra fields dropped',
      len(s1['body']['query']) == 300 and s1['body']['top_k'] == 10 and s1['body']['min_score'] == 0 and set(s1['body']) == {'query', 'top_k', 'min_score'}, s1['body'])
s2 = next(c for c in srch if c['body']['query'] == '청소년')
check('F8 search: junk numbers fall back to safe bounds', s2['body']['top_k'] == 1 and s2['body']['min_score'] == 0, s2['body'])
sm = next(c for c in by_path('/v1/summarize') if c['body']['text'].startswith('첫 문장'))
check('F9 summarize: newlines kept, max_sentences clamped to 5', '\n' in sm['body']['text'] and sm['body']['max_sentences'] == 5, sm['body'])
check('F10 upstream data returned as {ok,data}', R['chat.ok']['data']['reply'] == 'ok' and R['chat.ok']['status'] == 200)
check('F11 the ingest/article paths were never contacted', not by_path('/v1/ingest') and not by_path('/v1/article') and not by_path('/v1/ingest/flush'))

# upstream failures must not leak internals
for n in ('up.error_body', 'up.not_json', 'up.keyrejected'):
    check(f'U1 {n} -> 502 generic error', code(n) == (502, 'wpos_coda_upstream_error'), R[n])
check('U2 upstream connection dropped -> 502 unavailable', code('up.dropped') == (502, 'wpos_coda_unavailable'), R['up.dropped'])
leak = json.dumps(out['results'], ensure_ascii=False)
check('U3 no upstream internals (paths, IPs, messages, key) in any response',
      not any(s in leak for s in ('Traceback', '/home/robots', '10.0.0.5', 'SECRET-INTERNAL', 'SECRET_GATEWAY_KEY', '127.0.0.1')), leak[:200])
check('U4 upstream rejecting our key is logged for the operator', 'CODA API' in stderr and 'WPOS_CODA_API_KEY' in stderr, stderr[-200:])

# rate limiting
check('L1 per-minute limit: 3 pass, 4th -> 429', [R[f'rate.min.{i}']['status'] for i in (1, 2, 3, 4)] == [200, 200, 200, 429], [R[f'rate.min.{i}']['status'] for i in (1, 2, 3, 4)])
check('L2 429 code is rate_limited; other endpoint has its own counter', R['rate.min.4']['code'] == 'wpos_coda_rate_limited' and R['rate.min.otheruser_scope']['status'] == 200)
check('L3 daily quota: 2 pass, 3rd -> 429 quota_exceeded', [R[f'rate.day.{i}']['status'] for i in (1, 2, 3)] == [200, 200, 429] and R['rate.day.3']['code'] == 'wpos_coda_quota_exceeded')

# audit log carries no content
acts = [l[2] for l in out['logs']]
check('G1 audit log has coda_chat/search/summarize and only (client,user,action)', {'coda_chat', 'coda_search', 'coda_summarize'} <= set(acts)
      and all(len(l) == 3 and l[1] == 7 for l in out['logs']), out['logs'][:3])
# successful chat forwards: chat.ok (1) + rate.min 1-3 (3) + rate.day 1-2 (2) = 6; the 5 failed upstream / denied calls must not count
check('G2 only successful forwards are logged as usage (6 chat calls succeeded)', acts.count('coda_chat') == 6, acts)

print(f'\n{sum(res)}/{len(res)} passed')
sys.exit(0 if all(res) else 1)
