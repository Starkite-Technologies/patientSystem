"""Emergency theatre list (Phase 1). Clinical rules and permissions are enforced by the database functions;
these views validate shapes and forward the signed-in user's token."""
from datetime import date, datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied

from .gateway import request_supabase, staff_role
from .serializers import (TheatreBookingRequest, TheatreCancelRequest, TheatrePriorityRequest, TheatreTimeRequest,
                          TheatreUpdateRequest)
from .views import response

OPEN_STATUSES = 'booked,anaesthesia,operating'


def legacy_only():
    if settings.NECMS_ENABLED:
        raise PermissionDenied('Select an authorised hospital context.')


def plain(values):
    # JSON-safe copy of validated data (only the keys the client sent).
    return {key: value.isoformat() if isinstance(value, (datetime, date)) else str(value) if isinstance(value, UUID) else value
            for key, value in values.items()}


def validated(serializer_class, data):
    serializer = serializer_class(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


@api_view(['GET'])
def board(request):
    legacy_only()
    role = staff_role(request.auth, request.user.id)
    recent = (timezone.now() - timedelta(hours=24)).isoformat()
    codes = request_supabase('GET', '/rest/v1/theatre_priority_codes', request.auth, params={'select': '*', 'order': 'sort_order.asc'})
    bookings = request_supabase('GET', '/rest/v1/theatre_board', request.auth, params={
        'select': '*', 'or': f'(status.in.({OPEN_STATUSES}),updated_at.gte.{recent})',
        'order': 'priority_order.asc,deadline_at.asc,booked_at.asc'})
    theatres = request_supabase('GET', '/rest/v1/resources', request.auth, params={
        'select': 'id,name,state', 'kind': 'eq.Operating room', 'order': 'name.asc'})
    staff = request_supabase('POST', '/rest/v1/rpc/list_theatre_staff', request.auth, body={})
    return response({'role': role, 'codes': codes, 'bookings': bookings, 'theatres': theatres, 'staff': staff})


@api_view(['POST'])
def book(request):
    legacy_only()
    values = validated(TheatreBookingRequest, request.data)
    saved = request_supabase('POST', '/rest/v1/rpc/book_theatre_case', request.auth, body={'p_input': plain(values['input'])})
    return response({'id': saved}, status=201)


@api_view(['PATCH'])
def update(request, booking_id):
    legacy_only()
    values = validated(TheatreUpdateRequest, request.data)
    request_supabase('POST', '/rest/v1/rpc/update_theatre_case', request.auth, body={
        'p_id': str(booking_id), 'p_version': values['version'], 'p_input': plain(values['input'])})
    return response({'status': 'updated'})


@api_view(['POST'])
def priority(request, booking_id):
    legacy_only()
    values = validated(TheatrePriorityRequest, request.data)
    request_supabase('POST', '/rest/v1/rpc/change_theatre_priority', request.auth, body={
        'p_id': str(booking_id), 'p_version': values['version'], 'p_code': values['code'], 'p_reason': values['reason']})
    return response({'status': 'updated'})


@api_view(['POST'])
def record_time(request, booking_id):
    legacy_only()
    values = validated(TheatreTimeRequest, request.data)
    request_supabase('POST', '/rest/v1/rpc/record_theatre_time', request.auth, body={
        'p_id': str(booking_id), 'p_version': values['version'], 'p_event': values['event'],
        'p_at': values['at'].isoformat() if values.get('at') else None})
    return response({'status': 'updated'})


@api_view(['POST'])
def cancel(request, booking_id):
    legacy_only()
    values = validated(TheatreCancelRequest, request.data)
    request_supabase('POST', '/rest/v1/rpc/cancel_theatre_case', request.auth, body={
        'p_id': str(booking_id), 'p_version': values['version'], 'p_reason': values['reason'], 'p_authorised_by': values['authorised_by']})
    return response({'status': 'cancelled'})


@api_view(['GET'])
def history(request, booking_id):
    legacy_only()
    changes = request_supabase('GET', '/rest/v1/theatre_priority_changes', request.auth, params={
        'select': 'from_code,to_code,changed_by_name,changed_at,reason', 'booking_id': f'eq.{booking_id}', 'order': 'changed_at.asc'})
    return response({'changes': changes})
