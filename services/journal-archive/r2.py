#!/usr/bin/env python3
"""Minimal Cloudflare R2 (S3 API) client, stdlib only — the server's curl 7.81 signs SigV4 wrongly for R2.
  r2.py put <file> <key>    r2.py get <key> <out-file>    r2.py list [prefix]
Credentials from the environment: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
Prints the HTTP status; exits 1 unless it is 200."""
import datetime, hashlib, hmac, os, sys, urllib.error, urllib.parse, urllib.request


def request(method, key, body=b'', query=''):
    host = urllib.parse.urlparse(os.environ['R2_ENDPOINT']).netloc
    path = '/' + os.environ['R2_BUCKET'] + ('/' + urllib.parse.quote(key) if key else '')
    now = datetime.datetime.now(datetime.timezone.utc)
    amz, day = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    payload = hashlib.sha256(body).hexdigest()
    canonical = '\n'.join([method, path, query, f'host:{host}', f'x-amz-content-sha256:{payload}', f'x-amz-date:{amz}', '',
                           'host;x-amz-content-sha256;x-amz-date', payload])
    scope = f'{day}/auto/s3/aws4_request'
    to_sign = '\n'.join(['AWS4-HMAC-SHA256', amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = ('AWS4' + os.environ['R2_SECRET_ACCESS_KEY']).encode()
    for part in (day, 'auto', 's3', 'aws4_request'):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = (f"AWS4-HMAC-SHA256 Credential={os.environ['R2_ACCESS_KEY_ID']}/{scope}, "
            f'SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={sig}')
    req = urllib.request.Request(f'https://{host}{path}' + ('?' + query if query else ''), data=body or None, method=method,
                                 headers={'x-amz-content-sha256': payload, 'x-amz-date': amz, 'Authorization': auth})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


cmd = sys.argv[1]
if cmd == 'put':
    status, out = request('PUT', sys.argv[3], open(sys.argv[2], 'rb').read())
elif cmd == 'get':
    status, out = request('GET', sys.argv[2])
    if status == 200:
        open(sys.argv[3], 'wb').write(out)
else:
    prefix = sys.argv[2] if len(sys.argv) > 2 else ''
    status, out = request('GET', '', query='list-type=2&prefix=' + urllib.parse.quote(prefix, safe=''))
    if status == 200:
        import re
        for k, size in re.findall(rb'<Key>(.*?)</Key>.*?<Size>(\d+)</Size>', out):
            print(k.decode(), size.decode())
print(status, file=sys.stderr)
if status != 200:
    sys.stderr.write(out.decode(errors='replace')[:300] + '\n')
    sys.exit(1)
