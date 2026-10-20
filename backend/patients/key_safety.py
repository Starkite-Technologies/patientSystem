"""Configuration screening; JWT contents are not authentication evidence."""
import base64
import json


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
