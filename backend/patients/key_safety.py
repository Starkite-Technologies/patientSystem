"""Configuration screening; JWT contents are not authentication evidence."""
import base64
import json
from urllib.parse import urlparse

LOOPBACK_HOSTS = ('127.0.0.1', 'localhost', '::1')


def supabase_url_allowed(url):
    # HTTPS everywhere, except plain HTTP to a self-hosted gateway on this machine.
    try:
        parsed = urlparse(url)
        host = parsed.hostname
    except ValueError:
        return False
    if parsed.scheme == 'https':
        return bool(host)
    return parsed.scheme == 'http' and host in LOOPBACK_HOSTS


def public_key_allowed(key):
    if key.startswith('sb_secret_'):
        return False
    if not key.startswith('eyJ'):
        return True
    try:
        parts = key.split('.')
        if len(parts) != 3:
            return False
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
        return isinstance(payload, dict) and payload.get('role') == 'anon'
    except (ValueError, TypeError, UnicodeError):
        return False
