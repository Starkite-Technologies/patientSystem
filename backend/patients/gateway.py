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
}


def request_supabase(method, path, token, *, params=None, body=None):
    if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
        raise UpstreamUnavailable('Supabase project settings are missing on the backend.')
    try:
        response = httpx.request(
            method, settings.SUPABASE_URL + path,
            headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY, 'Authorization': f'Bearer {token}'},
            params=params, json=body, timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=False,
        )
    except httpx.RequestError:
        raise UpstreamUnavailable() from None
    if response.status_code == 401:
        raise AuthenticationFailed('Your staff session has expired. Sign in again.')
    if response.status_code == 403:
        raise PermissionDenied('Your staff account cannot perform this action.')
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
        if code == '23505':
            raise WorkflowConflict('The patient reference or assigned space is already in use.')
        if code == '42501':
            raise PermissionDenied('Your staff account cannot perform this action.')
        if message in WORKFLOW_MESSAGES:
            raise WorkflowConflict(message)
        if code in ('23514', '23502', '22P02', '23503'):
            raise ValidationError('The record contains invalid values. Review the form and try again.')
        # Never expose raw database details, upstream URLs, or credentials.
        raise UpstreamUnavailable()
    return data


def staff_role(token, user_id):
    rows = request_supabase('GET', '/rest/v1/staff_profiles', token, params={'select': 'role', 'id': f'eq.{user_id}'})
    if not isinstance(rows, list) or len(rows) != 1 or rows[0].get('role') not in ('viewer', 'clinician', 'coordinator', 'nurse', 'surgeon'):
        raise PermissionDenied('This account has no staff profile. Ask your administrator to provision access.')
    return rows[0]['role']
