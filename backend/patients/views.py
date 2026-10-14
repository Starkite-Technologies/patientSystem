from django.conf import settings
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .gateway import request_supabase, staff_role
from .serializers import ResourceSerializer, VisitRequestSerializer, VisitUpdateSerializer


def response(data, status=200):
    result = Response(data, status=status)
    result['Cache-Control'] = 'no-store'
    return result


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    configured = bool(settings.SUPABASE_URL and settings.SUPABASE_PUBLISHABLE_KEY)
    return response({'status': 'ok', 'supabase_configured': configured})


@api_view(['GET'])
def board(request):
    role = staff_role(request.auth, request.user.id)
    visits = request_supabase('GET', '/rest/v1/visit_board', request.auth, params={'select': '*', 'order': 'arrived_at.asc'})
    resources = request_supabase('GET', '/rest/v1/resources', request.auth, params={'select': '*', 'order': 'name.asc'})
    events = request_supabase('GET', '/rest/v1/audit_events', request.auth, params={'select': 'id,visit_id,actor,action,created_at,summary', 'order': 'created_at.desc', 'limit': '30'})
    return response({'visits': visits, 'resources': resources, 'events': events, 'role': role})


def write_visit(request, visit_id=None):
    role = staff_role(request.auth, request.user.id)
    if role not in ('clinician', 'coordinator', 'nurse', 'surgeon'):
        raise PermissionDenied('A nurse, surgeon, clinician, or coordinator account is required.')
    serializer = VisitUpdateSerializer(data=request.data) if visit_id else VisitRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    visit_input = dict(values['input'])
    if visit_input['date_of_birth'] is not None:
        visit_input['date_of_birth'] = visit_input['date_of_birth'].isoformat()
    if visit_input['resource_id'] is not None:
        visit_input['resource_id'] = str(visit_input['resource_id'])
    saved = request_supabase('POST', '/rest/v1/rpc/save_visit', request.auth, body={
        'p_input': visit_input, 'p_id': str(visit_id) if visit_id else None,
        'p_version': values.get('version'), 'p_patient_version': values.get('patient_version'),
    })
    return response({'id': saved}, status=200 if visit_id else 201)


@api_view(['POST'])
def create_visit(request):
    return write_visit(request)


@api_view(['PATCH'])
def update_visit(request, visit_id):
    return write_visit(request, visit_id)


@api_view(['PATCH'])
def update_resource(request, resource_id):
    if staff_role(request.auth, request.user.id) not in ('nurse', 'coordinator'):
        raise PermissionDenied('A nurse or coordinator account is required.')
    serializer = ResourceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    request_supabase('POST', '/rest/v1/rpc/set_resource_state', request.auth, body={'p_id': str(resource_id), 'p_state': serializer.validated_data['state']})
    return response({'status': 'updated'})
