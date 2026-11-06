"""Coordinator CSV export of the single-department board and completed visits."""
import csv
import io
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError

from .gateway import request_supabase, staff_role
from .serializers import ACTIVE_STATUSES, COMPLETED_STATUSES, ExportQuerySerializer

HOSPITAL_TZ = ZoneInfo('Africa/Johannesburg')
PAGE_SIZE = 1000
MAX_ROWS = 10000
# Same categories as src/model.ts (database values stay 1-5).
TRIAGE = [('Red', 'Immediate', 'Seen at once', 0), ('Orange', 'Very urgent', 'Within 10 min', 10),
          ('Yellow', 'Urgent', 'Within 60 min', 60), ('Green', 'Standard', 'Within 120 min', 120),
          ('Blue', 'Non-urgent', 'Within 240 min', 240)]
STATUS_LABELS = {'waiting': 'Waiting', 'ready': 'Ready', 'in_treatment': 'In treatment', 'awaiting_results': 'Awaiting results',
                 'observation': 'Observation', 'discharged': 'Discharged', 'transferred': 'Transferred'}
ACTION_LABELS = {'assessment': 'Clinical assessment', 'imaging': 'Imaging', 'laboratory': 'Laboratory', 'treatment': 'Treatment',
                 'surgery': 'Surgery', 'admission': 'Ward admission', 'none': 'No pending action'}
COLUMNS = ['Patient reference', 'First name', 'Last name', 'Date of birth', 'Age at arrival', 'Triage', 'Target', 'Status',
           'Location', 'Next service', 'Responsible clinician', 'Presenting complaint', 'Arrived', 'Time in ED (minutes)',
           'Overdue (minutes)', 'Last updated']


def safe_cell(value):
    # Spreadsheet apps treat these leading characters as formulas.
    text = '' if value is None else str(value)
    return "'" + text if text[:1] in ('\t', '\r', '\n') or text.lstrip(' \t\r\n')[:1] in ('=', '+', '-', '@') else text


def local_time(value):
    return datetime.fromisoformat(value).astimezone(HOSPITAL_TZ)


def age_at(birth, on):
    if not birth:
        return ''
    born = date.fromisoformat(birth)
    if born > on:
        return ''
    return on.year - born.year - ((on.month, on.day) < (born.month, born.day))


def full_name(row):
    return ' '.join(part for part in (row.get('first_name'), row.get('last_name')) if part) or 'Identity not yet recorded'


def fetch_rows(token, query):
    statuses = [query['status']] if query.get('status') else (ACTIVE_STATUSES if query['scope'] == 'board' else COMPLETED_STATUSES)
    params = [('select', '*'), ('order', 'arrived_at.asc,id.asc'), ('status', f"in.({','.join(statuses)})")]
    if query.get('priority'):
        params.append(('priority', f"eq.{query['priority']}"))
    if query.get('action'):
        params.append(('next_action', f"eq.{query['action']}"))
    if query.get('date_from'):
        params.append(('arrived_at', 'gte.' + datetime.combine(query['date_from'], time.min, HOSPITAL_TZ).isoformat()))
    if query.get('date_to'):
        params.append(('arrived_at', 'lt.' + datetime.combine(query['date_to'] + timedelta(days=1), time.min, HOSPITAL_TZ).isoformat()))
    rows, offset = [], 0
    while True:
        page = request_supabase('GET', '/rest/v1/visit_board', token,
                                params=params + [('limit', str(PAGE_SIZE)), ('offset', str(offset))])
        rows.extend(page)
        if len(rows) > MAX_ROWS:
            raise ValidationError('More than 10,000 visits match. Narrow the date range.')
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    needle = query.get('q', '').strip().lower()
    if needle:
        rows = [r for r in rows if needle in ' '.join(str(r.get(k) or '') for k in ('patient_ref', 'complaint', 'assigned_to', 'location')).lower()
                + ' ' + full_name(r).lower()]
    # Board order: Red first through Blue, then by arrival time.
    return sorted(rows, key=lambda r: (r.get('priority') or 99, r['arrived_at'], r['id']))


def csv_row(row, scope, now):
    arrived = local_time(row['arrived_at'])
    updated = local_time(row['updated_at'])
    priority = row.get('priority')
    category = TRIAGE[priority - 1] if priority in range(1, 6) else None
    end = now if scope == 'board' else updated
    minutes = max(0, int((end - arrived).total_seconds() // 60))
    overdue = ''
    if scope == 'board' and category and row.get('status') in ('waiting', 'ready') and minutes > category[3]:
        overdue = minutes - category[3]
    return [row.get('patient_ref'), row.get('first_name'), row.get('last_name'), row.get('date_of_birth') or '',
            age_at(row.get('date_of_birth'), arrived.date()),
            f'P{priority} · {category[0]} – {category[1]}' if category else 'Not yet triaged', category[2] if category else '',
            STATUS_LABELS.get(row.get('status'), row.get('status')), row.get('location') or 'Unassigned',
            ACTION_LABELS.get(row.get('next_action'), row.get('next_action')), row.get('assigned_to') or 'Unassigned',
            row.get('complaint') or '', arrived.strftime('%Y-%m-%d %H:%M'), minutes, overdue, updated.strftime('%Y-%m-%d %H:%M')]


THEATRE_COLUMNS = ['Booking reference', 'Patient reference', 'MRN', 'First name', 'Last name', 'Date of birth', 'Sex', 'Specialty',
                   'Responsible consultant', 'Booked by', 'Diagnosis', 'Proposed operation', 'Indication', 'Priority code',
                   'NCEPOD category', 'Target', 'Decision to operate', 'Booked', 'Deadline', 'Minutes remaining (negative = over)',
                   'Status', 'Ready for theatre', 'Theatre', 'Planned start', 'Anaesthesia start', 'Surgery start', 'Completed',
                   'Delay reason', 'Delay note', 'Cancellation reason']
THEATRE_STATUS = {'booked': 'Awaiting theatre', 'anaesthesia': 'Anaesthesia started', 'operating': 'Surgery started',
                  'completed': 'Completed', 'cancelled': 'Cancelled'}


def fetch_theatre_rows(token, query):
    # No dates: the open theatre list. With dates: every case decided in that range (including completed/cancelled).
    params = [('select', '*'), ('order', 'priority_order.asc,deadline_at.asc,booked_at.asc')]
    if query.get('date_from'):
        params.append(('decision_at', 'gte.' + datetime.combine(query['date_from'], time.min, HOSPITAL_TZ).isoformat()))
    if query.get('date_to'):
        params.append(('decision_at', 'lt.' + datetime.combine(query['date_to'] + timedelta(days=1), time.min, HOSPITAL_TZ).isoformat()))
    if not query.get('date_from') and not query.get('date_to'):
        params.append(('status', 'in.(booked,anaesthesia,operating)'))
    rows, offset = [], 0
    while True:
        page = request_supabase('GET', '/rest/v1/theatre_board', token, params=params + [('limit', str(PAGE_SIZE)), ('offset', str(offset))])
        rows.extend(page)
        if len(rows) > MAX_ROWS:
            raise ValidationError('More than 10,000 theatre cases match. Narrow the date range.')
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    needle = query.get('q', '').strip().lower()
    if needle:
        keys = ('booking_ref', 'patient_ref', 'mrn', 'proposed_operation', 'diagnosis', 'responsible_consultant', 'specialty')
        rows = [r for r in rows if needle in (' '.join(str(r.get(k) or '') for k in keys) + ' ' + full_name(r)).lower()]
    return rows


def theatre_csv_row(row, now):
    stamp = lambda value: local_time(value).strftime('%Y-%m-%d %H:%M') if value else ''
    deadline = local_time(row['deadline_at'])
    remaining = int((deadline - now).total_seconds() // 60) if row.get('status') == 'booked' else ''
    return [row.get('booking_ref'), row.get('patient_ref'), row.get('mrn'), row.get('first_name'), row.get('last_name'),
            row.get('date_of_birth') or '', row.get('sex'), row.get('specialty') or 'Not recorded', row.get('responsible_consultant') or 'Not recorded',
            row.get('booked_by_name'), row.get('diagnosis'), row.get('proposed_operation'), row.get('indication'), row.get('priority_code'),
            (row.get('ncepod') or '').capitalize(), row.get('priority_label'), stamp(row.get('decision_at')), stamp(row.get('booked_at')),
            stamp(row.get('deadline_at')), remaining, THEATRE_STATUS.get(row.get('status'), row.get('status')),
            'Yes' if row.get('ready_for_theatre') else 'No', row.get('theatre_name') or '', stamp(row.get('planned_start')),
            stamp(row.get('anaesthesia_start_at')), stamp(row.get('incision_at')), stamp(row.get('completed_at')),
            (row.get('delay_category') or '').replace('_', ' '), row.get('delay_note'), row.get('cancelled_reason')]


@api_view(['GET'])
def export_visits(request):
    if settings.NECMS_ENABLED:
        raise PermissionDenied('Select an authorised hospital context.')
    params = request.query_params.dict()
    params['date_from'], params['date_to'] = params.pop('from', None), params.pop('to', None)
    serializer = ExportQuerySerializer(data={k: v for k, v in params.items() if v not in (None, '')})
    serializer.is_valid(raise_exception=True)
    query = serializer.validated_data
    role = staff_role(request.auth, request.user.id)
    theatre = query['scope'] == 'theatre'
    if theatre and role not in ('coordinator', 'surgeon', 'anaesthetist'):
        raise PermissionDenied('Only coordinators, surgeons and anaesthetists can export the theatre list.')
    if not theatre and role != 'coordinator':
        raise PermissionDenied('Only coordinators can export visits.')
    rows = fetch_theatre_rows(request.auth, query) if theatre else fetch_rows(request.auth, query)

    filters = {key: str(value) for key, value in query.items() if key != 'scope' and value not in (None, '')}
    # Record before releasing any data: no audit entry, no file.
    request_supabase('POST', '/rest/v1/rpc/record_export', request.auth, body={
        'p_scope': query['scope'], 'p_filters': filters,
        'p_patient_refs': [r.get('booking_ref' if theatre else 'patient_ref') for r in rows]})

    now = timezone.now().astimezone(HOSPITAL_TZ)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\r\n')
    writer.writerow(THEATRE_COLUMNS if theatre else COLUMNS)
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in (theatre_csv_row(row, now) if theatre else csv_row(row, query['scope'], now))])
    name = {'board': 'visits', 'completed': 'completed-visits', 'theatre': 'theatre-list'}[query['scope']]
    result = HttpResponse('﻿' + buffer.getvalue(), content_type='text/csv; charset=utf-8')
    result['Content-Disposition'] = f'attachment; filename="patientflow-{name}-{now.date().isoformat()}.csv"'
    result['X-PatientFlow-Rows'] = str(len(rows))
    result['Cache-Control'] = 'no-store'
    return result
