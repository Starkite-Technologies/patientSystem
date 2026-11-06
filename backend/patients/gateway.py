import httpx
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError

from .exceptions import UpstreamUnavailable, WorkflowConflict

WORKFLOW_MESSAGES = {
    'This space is not available.',
    'This space is already assigned to another patient.',
    'This patient was updated elsewhere. Close and reopen the record.',
    'Release the assigned patient before changing this space.',
    'Patient visit not found.',
    'Space not found.',
    'Patient details were updated elsewhere. Close and reopen the record.',
    'Reload the patient record before changing identity details.',
    'The patient reference cannot be changed on an existing visit.',
    'This patient reference has different identity details. Review the existing patient record before registering another visit.',
    # Theatre list (202610310001_pilot_theatre_list.sql).
    'Enter the proposed operation and the patient\'s location.',
    'Choose a priority code.',
    'The decision to operate must be within the last 7 days and not in the future.',
    'Complete all required booking fields, or use rapid booking for an immediate case.',
    'Enter the patient\'s first and last name.',
    'Patient not found.',
    'Theatre case not found.',
    'This theatre case was updated elsewhere. Close and reopen it.',
    'This theatre case is closed.',
    'Use Change priority to change the priority code.',
    'Nothing to update.',
    'Unknown theatre field.',
    'Choose an operating theatre.',
    'This case is past its deadline. Record the reason for delay.',
    'Give the clinical reason for the priority change.',
    'The case already has this priority.',
    'That time must be after the decision to operate and not in the future.',
    'Anaesthesia start can only be recorded for a booked case.',
    'Assign a theatre first.',
    'Surgery start can only be recorded before the case is completed.',
    'Surgery cannot start before anaesthesia.',
    'Only a case in theatre can be completed.',
    'Completion cannot be before the start.',
    'Unknown theatre event.',
    'Give the reason for cancelling.',
    'Record which consultant authorised the cancellation.',
    'Only a case that has not started can be cancelled.',
}
# Role refusals whose wording helps staff (others stay generic).
PERMISSION_MESSAGES = {
    'Only clinicians, surgeons and anaesthetists can book theatre cases.',
    'Only clinicians, surgeons and anaesthetists can change clinical details.',
    'Your role cannot change theatre readiness.',
    'Only the theatre coordinator, surgeon or anaesthetist can assign a theatre.',
    'Your role cannot record the reason for delay.',
    'Only a consultant surgeon or anaesthetist can change the priority.',
    'Your role cannot record theatre times.',
    'Only the consultant surgeon or the theatre coordinator can cancel a case.',
    'Your role cannot export this list.',
}
STAFF_ROLES = ('viewer', 'clinician', 'coordinator', 'nurse', 'surgeon', 'anaesthetist')


def request_supabase(method, path, token, *, params=None, body=None, context=None):
    if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
        raise UpstreamUnavailable('Supabase project settings are missing on the backend.')
    try:
        response = httpx.request(
            method, settings.SUPABASE_URL + path,
            headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY, 'Authorization': f'Bearer {token}',
                     **({'X-NECMS-Context': str(context)} if context else {})},
            params=params, json=body, timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=False,
        )
    except httpx.RequestError:
        raise UpstreamUnavailable() from None
    if response.status_code == 401:
        raise AuthenticationFailed('Your staff session has expired. Sign in again.')
    if response.status_code == 403:
        try:
            denied = response.json().get('message', '')
        except (ValueError, AttributeError):
            denied = ''
        raise PermissionDenied(denied if denied in PERMISSION_MESSAGES else 'Your staff account cannot perform this action.')
    if path == '/auth/v1/user' and response.status_code in (400, 422):
        raise AuthenticationFailed('Invalid staff session.')
    try:
        data = response.json() if response.content else None
    except ValueError:
        raise UpstreamUnavailable('Supabase returned an unexpected response.') from None
    if response.is_error:
        code = data.get('code', '') if isinstance(data, dict) else ''
        message = data.get('message', '') if isinstance(data, dict) else ''
        if code in ('PGRST205', 'PGRST202', '42P01', '42703', '42883'):
            raise UpstreamUnavailable('Apply the PatientFlow Supabase migration before using the board.')
        if code in ('40001','40P01','55P03'):
            raise WorkflowConflict('The coordination record changed or is busy. Refresh before retrying.')
        if code == '23505':
            if 'one_case_in_each_theatre' in message:
                raise WorkflowConflict('This theatre already has a case in progress.')
            raise WorkflowConflict('The patient reference or assigned space is already in use.')
        if code == '42501':
            raise PermissionDenied(message if message in PERMISSION_MESSAGES else 'Your staff account cannot perform this action.')
        if message in WORKFLOW_MESSAGES:
            raise WorkflowConflict(message)
        if code in ('23514', '23502', '22P02', '23503'):
            raise ValidationError('The record contains invalid values. Review the form and try again.')
        # Never expose raw database details, upstream URLs, or credentials.
        raise UpstreamUnavailable()
    return data


def staff_role(token, user_id):
    rows = request_supabase('GET', '/rest/v1/staff_profiles', token, params={'select': 'role', 'id': f'eq.{user_id}'})
    if not isinstance(rows, list) or len(rows) != 1 or rows[0].get('role') not in STAFF_ROLES:
        raise PermissionDenied('This account has no staff profile. Ask your administrator to provision access.')
    return rows[0]['role']
