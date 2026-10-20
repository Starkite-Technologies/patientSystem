from unittest.mock import Mock, patch
from django.test import SimpleTestCase, override_settings, RequestFactory
from rest_framework.test import APIClient
from django.http import HttpResponse
from .middleware import ClinicalCacheControl
from .gateway import request_supabase
from .exceptions import WorkflowConflict


@override_settings(DEBUG=False)
class PrivacyHeaderTests(SimpleTestCase):
    def test_all_statuses_are_noncacheable_and_context_varies(self):
        for status in (200, 400, 401, 403, 404, 409, 500, 503):
            with self.subTest(status=status):
                middleware = ClinicalCacheControl(lambda request: HttpResponse(status=status))
                result = middleware(RequestFactory().get('/api/necms/private/'))
                self.assertEqual(result['Cache-Control'], 'no-store')
                self.assertEqual(set(result['Vary'].split(', ')), {'Authorization', 'X-NECMS-Context'})

    def test_unknown_api_route_and_auth_denial_are_noncacheable(self):
        for path in ('/api/not-a-route/', '/api/necms/hospitals/'):
            result = APIClient().get(path)
            self.assertIn(result.status_code, (401, 404))
            self.assertEqual(result['Cache-Control'], 'no-store')

    def test_non_api_static_response_is_unchanged(self):
        result = ClinicalCacheControl(lambda request: HttpResponse())(RequestFactory().get('/assets/app.js'))
        self.assertNotIn('Cache-Control', result)

    @override_settings(SUPABASE_URL='https://synthetic.invalid', SUPABASE_PUBLISHABLE_KEY='synthetic')
    def test_lock_timeout_has_safe_conflict_response(self):
        upstream = Mock(status_code=400, is_error=True, content=b'{}', json=lambda: {'code': '55P03', 'message': 'Private lock diagnostic'})
        with patch('patients.gateway.httpx.request', return_value=upstream):
            with self.assertRaises(WorkflowConflict) as failure:
                request_supabase('POST', '/rest/v1/rpc/necms_work_event', 'synthetic')
        self.assertNotIn('Private lock diagnostic', str(failure.exception))
