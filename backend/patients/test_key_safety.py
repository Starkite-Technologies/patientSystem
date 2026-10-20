import base64
import json
from unittest import TestCase
from .key_safety import public_key_allowed


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
