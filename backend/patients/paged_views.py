"""Bounded user-token reads. SQL independently validates every scope and filter."""
from uuid import UUID
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from .necms_views import hospital_context, rpc
from .views import response

CAPABILITIES = {
    'queue': 'queue.read', 'patients': 'patient.identity.read', 'encounters': 'encounter.read',
    'assessments': 'triage.read', 'vitals': 'triage.read', 'timeline': 'clinical.timeline.read',
    'work_events': 'queue.read', 'evidence': 'queue.read', 'exceptions': 'exception.review',
    'annotations': 'exception.review', 'audit': 'audit.summary.read', 'staff': 'queue.read',
    'teams': 'queue.read', 'services': 'queue.read', 'reasons': 'queue.read',
    'departments': 'encounter.read', 'resources': 'resource.read',
}
UUID_FILTERS = {'department', 'service', 'clinician', 'team', 'encounter', 'record'}
TEXT_FILTERS = {'q', 'state', 'urgency', 'triage'}
COMPANIONS = {
    'queue': ('encounter.read','patient.identity.read','resource.read'),
    'work_events': ('encounter.read','patient.identity.read'),
    'evidence': ('encounter.read','patient.identity.read'),
    'exceptions': ('queue.read','encounter.read','patient.identity.read'),
    'annotations': ('queue.read','encounter.read','patient.identity.read'),
    'encounters': ('patient.identity.read',), 'staff': ('patient.identity.read',),
    'assessments': ('encounter.read',), 'vitals': ('encounter.read',), 'timeline': ('encounter.read',),
}


def parameters(request, kind):
    filters_by_kind = {
        'queue': {'q','department','service','clinician','team','state','urgency','triage','encounter','closed'},
        'encounters': {'q','department','closed'}, 'patients': {'q'},
        'assessments': {'encounter'}, 'vitals': {'encounter'}, 'timeline': {'encounter'},
        'work_events': {'encounter'}, 'exceptions': {'encounter'}, 'audit': {'encounter'},
        'evidence': {'record'}, 'annotations': {'record'},
    }
    allowed = filters_by_kind.get(kind, {'q'}) | {'cursor', 'size'}
    if set(request.query_params) - allowed or any(len(request.query_params.getlist(k)) != 1 for k in request.query_params):
        raise ValidationError('Unknown or repeated page parameters.')
    values = request.query_params
    try:
        raw_size = values.get('size', '25')
        if not raw_size.isdecimal(): raise ValueError()
        size = int(raw_size)
        if not 1 <= size <= 50: raise ValueError()
        cursor = str(UUID(values['cursor'])) if values.get('cursor') else None
        filters = {k: str(UUID(values[k])) for k in UUID_FILTERS if values.get(k)}
    except (ValueError, TypeError):
        raise ValidationError('Invalid page size, identifier or cursor.') from None
    for name in TEXT_FILTERS:
        if values.get(name): filters[name] = values[name]
    if len(filters.get('q', '')) > 100: raise ValidationError('Search is limited to 100 characters.')
    if 'closed' in values:
        if values['closed'] not in ('true', 'false'): raise ValidationError('Invalid closed-record filter.')
        filters['closed'] = values['closed'] == 'true'
    enums = {'state': {'waiting','called','accepted','underway','deferred','completed','cancelled'},
             'triage': {'legacy_unassessed','not_yet_triaged','awaiting_review','completed_provisional'},
             'urgency': {'unknown','1','2','3','4','5'}}
    if any(k in filters and filters[k] not in choices for k, choices in enums.items()):
        raise ValidationError('Invalid queue filter.')
    return {'p_filters': filters, 'p_cursor': cursor, 'p_size': size}


@api_view(['GET'])
def page(request, hospital_id, kind):
    if kind not in CAPABILITIES: raise ValidationError('Unknown read collection.')
    context = hospital_context(request, hospital_id, CAPABILITIES[kind], required_capabilities=COMPANIONS.get(kind, ()))
    return response(rpc(request, 'necms_read_page', {'p_kind': kind, **parameters(request, kind)}, context))


@api_view(['GET'])
def workspace(request, hospital_id):
    context = hospital_context(request, hospital_id)
    info = rpc(request, 'necms_context_info', context=context)
    if 'encounter.read' not in info.get('capabilities', []):
        return response({**info, 'visits': [], 'resources': [], 'patients': [], 'events': [],
                         'page': {'total': 0, 'next_cursor': None}, 'resource_total': 0})
    hospital_context(request, hospital_id, 'encounter.read', required_capabilities=('patient.identity.read','resource.read'))
    page = rpc(request, 'necms_read_page', {'p_kind': 'encounters', **parameters(request, 'encounters')}, context)
    resources = rpc(request, 'necms_read_page', {'p_kind': 'resources', 'p_size': 50}, context)
    return response({**info, 'visits': page['items'], 'resources': resources['items'], 'patients': [], 'events': [],
                     'page': {k: v for k, v in page.items() if k != 'items'}, 'resource_total': resources['total']})
