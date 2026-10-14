"""User-token RPC gateway. No owner/service token and no clinical REST fallback."""
from uuid import UUID
import logging
from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from .gateway import request_supabase
from .serializers import ResourceSerializer, VisitRequestSerializer, VisitUpdateSerializer
from .views import response

logger = logging.getLogger(__name__)


def object_body(request, operation):
    data = request.data  # DRF ParseError remains a 400; unexpected errors propagate.
    if not isinstance(data, dict):
        logger.warning('Rejected non-object NECMS request body', extra={'operation': operation, 'status_code': 400})
        raise ValidationError('A JSON object is required.')
    return data


def enabled():
    if not settings.NECMS_ENABLED:
        raise PermissionDenied('NECMS development mode is not enabled.')


def rpc(request, name, body=None, context=None):
    return request_supabase('POST', '/rest/v1/rpc/' + name, request.auth,
                            body=body or {}, context=context)


def hospital_context(request, hospital_id, capability=None, purpose='clinical'):
    enabled()
    try:
        context = str(UUID(request.headers.get('X-NECMS-Context', '')))
    except (ValueError, TypeError, AttributeError):
        raise PermissionDenied('An authorised hospital context is required.') from None
    info = rpc(request, 'necms_context_info', context=context)
    if not isinstance(info, dict) or info.get('hospital_id') != str(hospital_id) or info.get('purpose') != purpose:
        raise PermissionDenied('Hospital context does not match this operation.')
    if capability and capability not in info.get('capabilities', []):
        raise PermissionDenied('Hospital capability required.')
    return context


@api_view(['GET'])
def hospitals(request):
    enabled()
    return response(rpc(request, 'necms_hospitals'))


@api_view(['POST'])
def contexts(request):
    enabled()
    data = object_body(request, 'context')
    try:
        hospital = str(UUID(str(data.get('hospital_id', ''))))
    except (ValueError, TypeError):
        raise ValidationError('A valid hospital is required.') from None
    purpose = data.get('purpose', 'clinical')
    if purpose not in ('clinical', 'display'):
        raise ValidationError('Invalid context purpose.')
    # Database derives auth.uid() and checks live membership; body has no authority.
    return response(rpc(request, 'necms_create_context', {'p_hospital': hospital, 'p_purpose': purpose}), 201)


@api_view(['GET'])
def board(request, hospital_id):
    context = hospital_context(request, hospital_id, 'encounter.read')
    return response(rpc(request, 'necms_board', context=context))


@api_view(['GET'])
def history(request, hospital_id):
    context = hospital_context(request, hospital_id, 'encounter.read')
    try:
        offset = int(request.query_params.get('offset', '0'))
    except ValueError:
        raise ValidationError('Invalid history offset.') from None
    if offset < 0:
        raise ValidationError('Invalid history offset.')
    return response(rpc(request, 'necms_history', {'p_offset': offset}, context))


@api_view(['GET'])
def display_board(request, hospital_id):
    context = hospital_context(request, hospital_id, 'display.read', 'display')
    return response(rpc(request, 'necms_display_board', context=context))


@api_view(['POST', 'PATCH'])
def visit(request, hospital_id, visit_id=None):
    if (visit_id is None) != (request.method == 'POST'):
        raise ValidationError('Invalid encounter operation.')
    context = hospital_context(request, hospital_id, 'encounter.update_legacy' if visit_id else 'encounter.register')
    if not isinstance(request.data, dict) or not isinstance(request.data.get('input'), dict):
        raise ValidationError('An encounter input object is required.')
    if 'hospital_id' in request.data or 'hospital_id' in request.data['input']:
        raise ValidationError('Hospital ownership is derived from context.')
    serializer = VisitUpdateSerializer(data=request.data) if visit_id else VisitRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    payload = dict(values['input'])
    if values.get('request_id'):
        payload['_request_id'] = str(values['request_id'])
    for field in ('resource_id', 'date_of_birth'):
        if payload[field] is not None:
            payload[field] = str(payload[field])
    saved = rpc(request, 'save_visit', {'p_input': payload, 'p_id': str(visit_id) if visit_id else None,
                'p_version': values.get('version'), 'p_patient_version': values.get('patient_version')}, context)
    return response({'id': saved}, 200 if visit_id else 201)


@api_view(['PATCH'])
def resource(request, hospital_id, resource_id):
    context = hospital_context(request, hospital_id, 'resource.coordinate')
    serializer = ResourceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    rpc(request, 'set_resource_state', {'p_id': str(resource_id), 'p_state': serializer.validated_data['state']}, context)
    return response({'status': 'updated'})


@api_view(['GET', 'POST'])
def staff(request, hospital_id):
    context = hospital_context(request, hospital_id, 'membership.manage')
    if request.method == 'GET':
        return response(rpc(request, 'necms_staff', context=context))
    data = object_body(request, 'staff')
    try:
        user_id, role_id = str(UUID(str(data.get('user_id', '')))), str(UUID(str(data.get('role_id', ''))))
    except ValueError:
        raise ValidationError('Valid staff and role UUIDs are required.') from None
    active, reason = data.get('active'), data.get('reason')
    if not isinstance(active, bool) or not isinstance(reason, str) or not reason.strip() or len(reason) > 300:
        raise ValidationError('Active state and a reason of at most 300 characters are required.')
    return response({'id': rpc(request, 'necms_set_membership',
        {'p_user': user_id, 'p_role': role_id, 'p_active': active, 'p_reason': reason}, context)})


@api_view(['GET', 'POST'])
def configuration(request, hospital_id):
    context = hospital_context(request, hospital_id, 'hospital.configure')
    settings_input = object_body(request, 'configuration').get('settings') if request.method == 'POST' else None
    if request.method == 'POST' and not isinstance(settings_input, dict):
        raise ValidationError('Operational settings must be an object.')
    return response(rpc(request, 'necms_configuration', {'p_settings': settings_input}, context))
