from unittest.mock import patch,Mock
from django.test import SimpleTestCase,override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import AuthenticationFailed
from .coordination_views import EVENT_CAPS
from .gateway import request_supabase
from .exceptions import WorkflowConflict
H='a0000000-0000-0000-0000-000000000001';U='60000000-0000-0000-0000-000000000001';W='96000000-0000-0000-0000-000000000001';C='70000000-0000-0000-0000-000000000001'
@override_settings(NECMS_ENABLED=True,DEBUG=False,SUPABASE_URL='https://example.invalid',SUPABASE_PUBLISHABLE_KEY='synthetic')
class CoordinationApiTests(SimpleTestCase):
 def setUp(self):
  self.client=APIClient();self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-coordination',HTTP_X_NECMS_CONTEXT=C)
  auth=patch('patients.authentication.request_supabase',return_value={'id':U});auth.start();self.addCleanup(auth.stop)
  self.caps=['queue.read','encounter.read','work.create','reassessment.request','work.assign','coordination.configure','exception.review',*EVENT_CAPS.values()]
  self.purpose='clinical'
  def upstream(method,path,token,**kwargs):return {'hospital_id':H,'purpose':self.purpose,'capabilities':self.caps} if path.endswith('necms_context_info') else {'id':W,'version':2}
  remote=patch('patients.necms_views.request_supabase',side_effect=upstream);self.remote=remote.start();self.addCleanup(remote.stop)
 def path(self,suffix=''):return f'/api/necms/hospitals/{H}/coordination/{suffix}'
 def payload(self):return {'request_id':W,'encounter_id':W,'service_id':W,'kind':'initial_review','title':'Synthetic coordination','eligible':True}
 def event(self,action='start'):return {'request_id':W,'version':1,'event':action}
 def test_board_requires_queue_permission(self):
  self.caps=['encounter.read'];self.assertEqual(self.client.get(self.path()).status_code,403)
 def test_display_context_cannot_fetch_operational_bundle(self):
  self.purpose='display';self.assertEqual(self.client.get(self.path()).status_code,403)
 def test_user_context_and_token_forwarded(self):
  self.assertEqual(self.client.get(self.path()).status_code,200);self.assertEqual(self.remote.call_args.args[2],'synthetic-coordination');self.assertEqual(self.remote.call_args.kwargs['context'],C)
 def test_work_creation_does_not_overwrite_legacy_next_action(self):
  self.assertEqual(self.client.post(self.path('work-items/'),self.payload(),format='json').status_code,201);self.assertNotIn('next_action',self.remote.call_args.kwargs['body']['p_input'])
 def test_reassessment_has_separate_permission(self):
  self.caps=['work.create'];self.assertEqual(self.client.post(self.path('work-items/'),{**self.payload(),'kind':'nursing_reassessment'},format='json').status_code,403)
 def test_missing_authentication(self):
  self.client.credentials();self.assertEqual(self.client.get(self.path()).status_code,401)
 def test_revoked_auth_cannot_record_events(self):
  with patch('patients.authentication.request_supabase',side_effect=AuthenticationFailed()):self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),self.event(),format='json').status_code,401)
  self.remote.assert_not_called()
 def test_forged_hospital_context_rejected(self):
  self.assertEqual(self.client.get(self.path().replace(H,'b0000000-0000-0000-0000-000000000001')).status_code,403)
 def test_server_ownership_cannot_be_submitted(self):
  self.assertEqual(self.client.post(self.path('work-items/'),{**self.payload(),'hospital_id':H},format='json').status_code,400)
 def test_all_event_types_have_their_own_capability(self):
  for event,cap in EVENT_CAPS.items():
   with self.subTest(event=event):
    self.caps=[];body={**self.event(event),'reason':'Synthetic operational explanation','eligible':True}
    self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),body,format='json').status_code,403)
 def test_start_needs_no_clinical_priority_or_sequencing_reason(self):
  self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),self.event(),format='json').status_code,200);self.assertEqual(self.remote.call_args.kwargs['body']['p_input']['reason'],'')
 def test_deferral_cancel_and_reassign_require_explanation(self):
  for action in ['defer','cancel','call_cancel','reassign']:self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),self.event(action),format='json').status_code,400)
 def test_late_documentation_has_two_times_not_an_invented_current_occurrence(self):
  body={**self.event(),'occurred_at':'2026-01-01T00:00:00Z'}
  self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),body,format='json').status_code,400)
  self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),{**body,'late_entry_reason':'Synthetic care began earlier'},format='json').status_code,200)
 def test_future_occurrence_is_invalid(self):
  self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),{**self.event(),'occurred_at':'2999-01-01T00:00:00Z','late_entry_reason':'Synthetic'},format='json').status_code,400)
 def test_same_retry_identifier_is_forwarded(self):
  for _ in range(2):self.client.post(self.path(f'work-items/{W}/events/'),self.event(),format='json')
  calls=[c.kwargs['body']['p_request'] for c in self.remote.call_args_list if c.args[1].endswith('necms_work_event')];self.assertEqual(calls,[W,W])
 def test_malformed_bodies_stay_400(self):
  for suffix in ['work-items/',f'work-items/{W}/events/',f'exceptions/{W}/review/','configuration/']:self.assertEqual(self.client.post(self.path(suffix),[],format='json').status_code,400)
  self.assertEqual(self.client.generic('POST',self.path('work-items/'),'{bad',content_type='application/json').status_code,400)
 def test_configuration_cannot_activate_escalation(self):
  self.assertEqual(self.client.post(self.path('configuration/'),{'request_id':W,'kind':'inactive_policy','version':'Synthetic','document_reference':'Synthetic pending review','active':True},format='json').status_code,400)
 def test_exception_review_requires_category_and_explanation(self):
  self.assertEqual(self.client.post(self.path(f'exceptions/{W}/review/'),{'request_id':W},format='json').status_code,400)
 def test_readiness_is_explicit(self):
  self.assertEqual(self.client.post(self.path(f'work-items/{W}/events/'),self.event('readiness'),format='json').status_code,400)
 def test_real_gateway_maps_stale_version_and_deadlock_to_409(self):
  for code in ['40001','40P01']:
   with self.subTest(code=code),patch('patients.gateway.httpx.request',return_value=Mock(status_code=400,content=b'{}',is_error=True,json=lambda:{'code':code,'message':'Internal lock diagnostic'})):
    with self.assertRaises(WorkflowConflict) as failure:request_supabase('POST','/rest/v1/rpc/necms_work_event','synthetic')
   self.assertEqual(failure.exception.status_code,409);self.assertNotIn('Internal lock diagnostic',str(failure.exception))
