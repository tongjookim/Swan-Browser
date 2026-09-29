<?php
define('ABSPATH', '/'); 
function add_action(...$a){} function add_filter(...$a){} function add_rewrite_rule(...$a){}
function wp_parse_url($u){ return parse_url($u); }
$dir = '/home/suwannews/www/wp-content/plugins/wp-oauth-server/includes/';
require $dir.'class-wpos-token.php';
require $dir.'class-wpos-db.php';
require $dir.'class-wpos-server.php';

$fail = 0;
function check($name, $cond){ global $fail; echo ($cond ? "PASS" : "FAIL")." $name\n"; if(!$cond) $fail++; }

// RFC 7636 appendix B
$v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
$c = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
check('s256 vector', WPOS_Token::pkce_s256($v) === $c);
check('verify ok', WPOS_Token::pkce_verify($v, $c));
check('verify wrong verifier', !WPOS_Token::pkce_verify(str_repeat('a',43), $c));
check('verify empty challenge', !WPOS_Token::pkce_verify($v, ''));
check('verify too-short verifier', !WPOS_Token::pkce_verify('short', $c));
check('verify bad charset', !WPOS_Token::pkce_verify(str_repeat('a',42).'!', $c));
check('valid string 128', WPOS_Token::is_valid_pkce_string(str_repeat('a',128)));
check('invalid string 129', !WPOS_Token::is_valid_pkce_string(str_repeat('a',129)));

$srv = new WPOS_Server();
$call = function($m, ...$args) use ($srv){ $r = new ReflectionMethod($srv, $m); $r->setAccessible(true); return $r->invoke($srv, ...$args); };
$pub  = (object)['is_public'=>1, 'redirect_uri'=>'http://127.0.0.1/callback'];
$conf = (object)['is_public'=>0, 'redirect_uri'=>'https://app.example.com/cb'];

// parse_pkce
[$ch,$m,$e] = $call('parse_pkce', ['code_challenge'=>$c,'code_challenge_method'=>'S256'], $pub);
check('pkce public ok', $ch===$c && $m==='S256' && $e===null);
check('pkce public missing -> error', $call('parse_pkce', [], $pub)[2] !== null);
check('pkce confidential missing -> ok (legacy)', $call('parse_pkce', [], $conf) === [null,null,null]);
check('pkce plain rejected', $call('parse_pkce', ['code_challenge'=>$c,'code_challenge_method'=>'plain'], $conf)[2] !== null);
check('pkce no method rejected', $call('parse_pkce', ['code_challenge'=>$c], $conf)[2] !== null);
check('pkce wrong length rejected', $call('parse_pkce', ['code_challenge'=>substr($c,0,42),'code_challenge_method'=>'S256'], $conf)[2] !== null);

// redirect_uri / loopback
check('loopback any port (public)', $call('validate_redirect_uri', $pub->redirect_uri, 'http://127.0.0.1:53211/callback', $pub));
check('loopback wrong path rejected', !$call('validate_redirect_uri', $pub->redirect_uri, 'http://127.0.0.1:53211/evil', $pub));
check('loopback other host rejected', !$call('validate_redirect_uri', $pub->redirect_uri, 'http://127.0.0.2:53211/callback', $pub));
check('loopback localhost name rejected', !$call('validate_redirect_uri', $pub->redirect_uri, 'http://localhost:53211/callback', $pub));
check('loopback https rejected', !$call('validate_redirect_uri', $pub->redirect_uri, 'https://127.0.0.1:53211/callback', $pub));
check('loopback query mismatch rejected', !$call('validate_redirect_uri', $pub->redirect_uri, 'http://127.0.0.1:1/callback?x=1', $pub));
check('loopback port NOT ignored for confidential', !$call('validate_redirect_uri', 'http://127.0.0.1/callback', 'http://127.0.0.1:53211/callback', $conf));
check('exact match still works (confidential)', $call('validate_redirect_uri', $conf->redirect_uri, 'https://app.example.com/cb/', $conf));
check('other https uri rejected', !$call('validate_redirect_uri', $conf->redirect_uri, 'https://evil.example.com/cb', $conf));
check('multi-line registered uris', $call('validate_redirect_uri', "https://a.example.com/cb\nhttps://b.example.com/cb", 'https://b.example.com/cb', $conf));
exit($fail ? 1 : 0);
