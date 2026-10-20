"""Synthetic, mocked upstream only. Real SQL constraints have a separate harness."""
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import AuthenticationFailed
from .clinical_views import VitalInput

H='a0000000-0000-0000-0000-000000000001'
V='a4000000-0000-0000-0000-000000000001'
U='60000000-0000-0000-0000-000000000001'
C='70000000-0000-0000-0000-000000000001'

@override_settings(NECMS_ENABLED=True,DEBUG=False)
class ClinicalApiTests(SimpleTestCase):
    def setUp(self):
        self.client=APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-clinical',HTTP_X_NECMS_CONTEXT=C)
        auth=patch('patients.authentication.request_supabase',return_value={'id':U});auth.start();self.addCleanup(auth.stop)
        self.caps=['arrival.register','identity.reconcile','triage.read','triage.create','triage.reassess','triage.review','protocol.admin','clinical.timeline.read']
        def remote(method,path,token,**kwargs):
            return {'hospital_id':H,'purpose':'clinical','capabilities':self.caps} if path.endswith('necms_context_info') else {'id':V,'encounter_id':V}
        upstream=patch('patients.necms_views.request_supabase',side_effect=remote);self.remote=upstream.start();self.addCleanup(upstream.stop)
    def path(self,suffix): return f'/api/necms/hospitals/{H}/{suffix}/'
    def arrival(self): return {'request_id':V,'department_id':V,'source':'ambulance','immediate_care':True}
    def assessment(self): return {'version':1,'request_id':V,'kind':'initial','complaint':'Synthetic','manual_priority':2,'vitals':[]}
    def test_unknown_arrival_needs_no_demographics_or_priority(self):
        result=self.client.post(self.path('arrivals'),self.arrival(),format='json');self.assertEqual(result.status_code,201)
        payload=self.remote.call_args.kwargs['body']['p_input'];self.assertIsNone(payload['first_name']);self.assertNotIn('priority',payload);self.assertTrue(payload['immediate_care'])
    def test_retries_forward_same_request_identifier(self):
        for _ in range(2): self.assertEqual(self.client.post(self.path('arrivals'),self.arrival(),format='json').status_code,201)
        requests=[call.kwargs['body']['p_input']['request_id'] for call in self.remote.call_args_list if call.args[1].endswith('necms_record_arrival')];self.assertEqual(requests,[V,V])
    def test_arrival_requires_separate_capability(self):
        self.caps=['encounter.register'];self.assertEqual(self.client.post(self.path('arrivals'),self.arrival(),format='json').status_code,403)
    def test_forged_hospital_body_rejected(self):
        self.assertEqual(self.client.post(self.path('arrivals'),{**self.arrival(),'hospital_id':H},format='json').status_code,400)
    def test_missing_authentication(self):
        self.client.credentials();self.assertEqual(self.client.post(self.path('arrivals'),self.arrival(),format='json').status_code,401)
    def test_revoked_auth_stops_new_assessment(self):
        with patch('patients.authentication.request_supabase',side_effect=AuthenticationFailed()): self.assertEqual(self.client.post(self.path(f'visits/{V}/assessments'),self.assessment(),format='json').status_code,401)
        self.remote.assert_not_called()
    def test_cross_hospital_route_context_rejected(self):
        path=self.path('arrivals').replace(H,'b0000000-0000-0000-0000-000000000001');self.assertEqual(self.client.post(path,self.arrival(),format='json').status_code,403)
    def test_assessment_and_reassessment_have_different_capabilities(self):
        self.caps=['triage.create'];path=self.path(f'visits/{V}/assessments')
        self.assertEqual(self.client.post(path,self.assessment(),format='json').status_code,201)
        self.assertEqual(self.client.post(path,{**self.assessment(),'kind':'reassessment'},format='json').status_code,403)
    def test_impossible_vital_rejected_before_mutation(self):
        body={**self.assessment(),'vitals':[{'kind':'oxygen_saturation','measurement_status':'measured','unit':'%','value':101}]}
        self.assertEqual(self.client.post(self.path(f'visits/{V}/assessments'),body,format='json').status_code,400)
        self.assertFalse(any(call.args[1].endswith('necms_record_assessment') for call in self.remote.call_args_list))
    def test_reconcile_requires_version_and_reason(self):
        self.assertEqual(self.client.post(self.path(f'patients/{V}/reconcile'),{'first_name':'Synthetic','last_name':'Person','date_of_birth':None},format='json').status_code,400)
    def test_reconcile_forwards_explicit_identity_not_merge_target(self):
        body={'first_name':'Synthetic','last_name':'Person','date_of_birth':None,'version':1,'reason':'Synthetic verification'}
        self.assertEqual(self.client.post(self.path(f'patients/{V}/reconcile'),body,format='json').status_code,200)
        self.assertEqual(self.client.post(self.path(f'patients/{V}/reconcile'),{**body,'merge_into':V},format='json').status_code,400)
    def test_malformed_arrays_and_json(self):
        for suffix in ['arrivals',f'patients/{V}/reconcile',f'visits/{V}/assessments',f'assessments/{V}/review','triage-protocols']:
            self.assertEqual(self.client.post(self.path(suffix),[],format='json').status_code,400)
        self.assertEqual(self.client.generic('POST',self.path('arrivals'),'{bad',content_type='application/json').status_code,400)
    def test_protocol_creation_cannot_request_activation_or_approval(self):
        self.assertEqual(self.client.post(self.path('triage-protocols'),{'protocol_identifier':'Synthetic','version':'1','activation_status':'active'},format='json').status_code,400)
        self.assertEqual(self.client.post(self.path('triage-protocols'),{'protocol_identifier':'Synthetic','version':'1'},format='json').status_code,201)
    def test_review_has_own_capability(self):
        self.caps=['triage.create'];self.assertEqual(self.client.post(self.path(f'assessments/{V}/review'),{'version':1,'decision':'accepted','reason':'Synthetic'},format='json').status_code,403)
    def test_timeline_has_own_capability(self):
        self.caps=['encounter.read'];self.assertEqual(self.client.get(self.path(f'visits/{V}/timeline')).status_code,403)
    def test_care_before_registration_or_triage_uses_existing_clinical_permission(self):
        self.caps=['encounter.update_legacy']
        body={'version':1,'status':'in_treatment','next_action':'treatment','resource_id':None,'assigned_to':'','location':''}
        self.assertEqual(self.client.post(self.path(f'visits/{V}/care'),body,format='json').status_code,200)
        self.assertNotIn('priority',self.remote.call_args.kwargs['body']['p_input'])
        self.assertEqual(self.client.post(self.path(f'visits/{V}/care'),{**body,'priority':1},format='json').status_code,400)
    def test_vital_formats_unknown_values_and_timestamps(self):
        cases=[({'kind':'heart_rate','unit':'bpm','measurement_status':'unknown'},True),({'kind':'heart_rate','unit':'bpm','measurement_status':'unknown','value':0},False),({'kind':'temperature','unit':'C','measurement_status':'measured','value':-274},False),({'kind':'blood_pressure','unit':'mmHg','measurement_status':'measured','systolic':80,'diastolic':120},False),({'kind':'pain','unit':'score/10','measurement_status':'measured','value':11},False),({'kind':'consciousness','unit':'text','measurement_status':'measured','text_value':'Synthetic'},True),({'kind':'heart_rate','unit':'bpm','measurement_status':'measured','value':0},True),({'kind':'heart_rate','unit':'bpm','measurement_status':'unknown','observed_at':'2999-01-01T00:00:00Z'},False)]
        for payload,valid in cases:
            with self.subTest(payload=payload): self.assertEqual(VitalInput(data=payload).is_valid(),valid)
