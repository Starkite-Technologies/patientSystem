from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from .test_necms import HOSPITAL, OTHER, CONTEXT
from .tests import USER_ID


@override_settings(NECMS_ENABLED=True)
class BoundedApiTests(SimpleTestCase):
    def setUp(self):
        self.client=APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic', HTTP_X_NECMS_CONTEXT=CONTEXT)
        self.caps=['queue.read','patient.identity.read','encounter.read','triage.read','clinical.timeline.read','exception.review','audit.summary.read','resource.read']
        self.purpose='clinical'
        def upstream(method,path,token,**kwargs):
            if path.endswith('necms_context_info'):return {'hospital_id':HOSPITAL,'purpose':self.purpose,'capabilities':self.caps}
            return {'items':[],'total':0,'next_cursor':None,'revision':'synthetic','server_time':'2026-10-19T00:00:00Z'}
        auth=patch('patients.authentication.request_supabase',return_value={'id':USER_ID});auth.start();self.addCleanup(auth.stop)
        rpc=patch('patients.necms_views.request_supabase',side_effect=upstream);self.remote=rpc.start();self.addCleanup(rpc.stop)
    def path(self,kind='queue'):return f'/api/necms/hospitals/{HOSPITAL}/read/{kind}/'
    def test_bounded_user_token_request(self):
        result=self.client.get(self.path(),{'size':10,'q':'Synthetic'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.remote.call_args.kwargs['body'],{'p_kind':'queue','p_filters':{'q':'Synthetic'},'p_size':10,'p_cursor':None})
        self.assertEqual(self.remote.call_args.args[2],'synthetic')
        self.assertEqual(result['Cache-Control'],'no-store')
    def test_invalid_or_excessive_page_sizes(self):
        for value in ('0','51','-1','1.5','true','99999999999999999999999'):
            with self.subTest(value=value):self.assertEqual(self.client.get(self.path(),{'size':value}).status_code,400)
    def test_forged_and_unknown_parameters(self):
        for values in ({'hospital_id':OTHER},{'department':'forged'},{'cursor':'bad'},{'state':'arbitrary'},{'urgency':'0'},{'q':'x'*101},{'closed':'yes'}):
            with self.subTest(values=values):self.assertEqual(self.client.get(self.path(),values).status_code,400)
    def test_duplicate_parameter_rejected(self):self.assertEqual(self.client.get(self.path()+'?size=1&size=2').status_code,400)
    def test_unsupported_filter_does_not_silently_broaden_search(self):self.assertEqual(self.client.get(self.path('patients'),{'department':HOSPITAL}).status_code,400)
    def test_capabilities_checked_per_collection(self):
        self.caps=[]
        for kind in ('queue','patients','assessments','vitals','timeline','work_events','evidence','exceptions','annotations','audit','staff'):
            with self.subTest(kind=kind):self.assertEqual(self.client.get(self.path(kind)).status_code,403)
    def test_wrong_hospital_never_runs_page_rpc(self):
        self.assertEqual(self.client.get(self.path().replace(HOSPITAL,OTHER)).status_code,403)
        self.assertEqual(self.remote.call_count,1)
    def test_display_cannot_request_paginated_clinical_records(self):
        self.purpose='display';self.assertEqual(self.client.get(self.path()).status_code,403)
    def test_missing_auth(self):
        self.client.credentials();self.assertEqual(self.client.get(self.path()).status_code,401)
    def test_exception_primary_permission_is_not_sufficient(self):
        self.caps=['exception.review']
        self.assertEqual(self.client.get(self.path('exceptions')).status_code,403)
        self.assertEqual(self.remote.call_count,1)
    def test_invalid_kind(self):self.assertEqual(self.client.get(self.path('invented')).status_code,400)
    def test_arrival_only_workspace_never_reads_clinical_records(self):
        self.caps=['arrival.register']
        result=self.client.get(f'/api/necms/hospitals/{HOSPITAL}/workspace/')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['visits'],[])
        self.assertTrue(all(c.args[1].endswith('necms_context_info') for c in self.remote.call_args_list))
    def test_identity_permission_cannot_be_bypassed_by_workspace(self):
        self.caps=['encounter.read','resource.read']
        self.assertEqual(self.client.get(f'/api/necms/hospitals/{HOSPITAL}/workspace/').status_code,403)
    def test_workspace_does_not_fetch_full_board(self):
        result=self.client.get(f'/api/necms/hospitals/{HOSPITAL}/workspace/')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['visits'],[])
        self.assertFalse(any(c.args[1].endswith('necms_board') for c in self.remote.call_args_list))
