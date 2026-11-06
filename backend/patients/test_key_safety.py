import base64
import json
from unittest import TestCase
from .key_safety import public_key_allowed, supabase_url_allowed


class SupabaseUrlSafetyTests(TestCase):
    def test_https_and_loopback_http(self):
        for url in ['https://synthetic.supabase.co', 'http://127.0.0.1:8100', 'http://localhost:8100', 'http://[::1]:8100']:
            self.assertTrue(supabase_url_allowed(url), url)

    def test_remote_http_and_other_schemes(self):
        for url in ['http://synthetic.supabase.co', 'http://10.0.0.5:8100', 'http://127.0.0.1.example.com',
                    'same-origin', 'ftp://127.0.0.1', 'https://', 'http://[bad']:
            self.assertFalse(supabase_url_allowed(url), url)


class PublicKeySafetyTests(TestCase):
    def jwt(self, role):
        return 'eyJheader.' + base64.urlsafe_b64encode(json.dumps({'role':role}).encode()).decode().rstrip('=') + '.synthetic'

    def test_public_keys(self):
        self.assertTrue(public_key_allowed('sb_publishable_synthetic'))
        self.assertTrue(public_key_allowed(self.jwt('anon')))

    def test_secret_keys(self):
        self.assertFalse(public_key_allowed('sb_secret_synthetic'))

    def test_privileged_legacy_keys(self):
        for role in ['service_role','authenticated','postgres']:
            self.assertFalse(public_key_allowed(self.jwt(role)))

    def test_malformed_legacy_keys(self):
        for key in ['eyJinvalid','eyJ.a.bad','eyJ.W10.bad']:
            self.assertFalse(public_key_allowed(key))
