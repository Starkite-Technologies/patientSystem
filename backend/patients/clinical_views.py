"""Local NECMS arrival/triage foundations. No scoring or protocol activation."""
import json
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.renderers import JSONRenderer
from .necms_views import hospital_context, rpc, object_body
from .serializers import StrictIntegerField, STATUSES, ACTIONS
from .views import response


class ArrivalInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    department_id = serializers.UUIDField()
    source = serializers.ChoiceField(choices=['walk-in', 'ambulance', 'referral', 'other'])
    referring_facility = serializers.CharField(max_length=200, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=160, allow_null=True, allow_blank=True, default=None)
    last_name = serializers.CharField(max_length=160, allow_null=True, allow_blank=True, default=None)
    date_of_birth = serializers.DateField(allow_null=True, default=None)
    immediate_care = serializers.BooleanField(default=False)

    def validate_date_of_birth(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError('Date of birth cannot be in the future.')
        return value


class ReconcileInput(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    first_name = serializers.CharField(max_length=160)
    last_name = serializers.CharField(max_length=160)
    date_of_birth = serializers.DateField(allow_null=True)
    reason = serializers.CharField(max_length=500)

    validate_date_of_birth = ArrivalInput.validate_date_of_birth


UNITS = {'heart_rate': 'bpm', 'respiratory_rate': 'breaths/min', 'blood_pressure': 'mmHg',
         'temperature': 'C', 'oxygen_saturation': '%', 'consciousness': 'text', 'pain': 'score/10'}


class VitalInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=list(UNITS))
    measurement_status = serializers.ChoiceField(choices=['measured', 'unknown', 'unavailable', 'not_measured'])
    unit = serializers.CharField()
    value = serializers.FloatField(allow_null=True, default=None)
    systolic = serializers.FloatField(allow_null=True, default=None)
    diastolic = serializers.FloatField(allow_null=True, default=None)
    text_value = serializers.CharField(max_length=160, allow_null=True, allow_blank=True, default=None)
    observed_at = serializers.DateTimeField(required=False)

    def validate(self, values):
        import math
        kind, state = values['kind'], values['measurement_status']
        if values['unit'] != UNITS[kind]:
            raise serializers.ValidationError('Incorrect observation unit.')
        if values.get('observed_at') and values['observed_at'] > timezone.now():
            raise serializers.ValidationError('Observation time cannot be in the future.')
        measurements = [values.get(key) for key in ('value', 'systolic', 'diastolic', 'text_value')]
        if state != 'measured':
            if any(value is not None for value in measurements):
                raise serializers.ValidationError('Unavailable measurements must have no substituted values.')
            return values
        for key in ('value', 'systolic', 'diastolic'):
            if values.get(key) is not None and not math.isfinite(values[key]):
                raise serializers.ValidationError('Measurement must be finite.')
        value, systolic, diastolic, text = measurements
        if kind == 'consciousness':
            valid = bool(text) and value is None and systolic is None and diastolic is None
        elif kind == 'blood_pressure':
            valid = systolic is not None and diastolic is not None and systolic >= diastolic >= 0 and value is None and text is None
        else:
            valid = value is not None and systolic is None and diastolic is None and text is None
            if valid:
                valid = value > -273.15 if kind == 'temperature' else 0 <= value <= 100 if kind == 'oxygen_saturation' else 0 <= value <= 10 if kind == 'pain' else value >= 0
        if not valid:
            raise serializers.ValidationError('Invalid measurement; check its value and recording format.')
        return values


class AssessmentInput(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    request_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=['initial', 'reassessment'])
    complaint = serializers.CharField(max_length=300)
    observations = serializers.DictField(child=serializers.CharField(max_length=1000), default=dict)
    manual_priority = StrictIntegerField(min_value=1, max_value=5)
    notes = serializers.CharField(max_length=2000, allow_blank=True, default='')
    protocol_version_id = serializers.UUIDField(allow_null=True, default=None)
    vitals = VitalInput(many=True, max_length=7, default=list)

    def validate(self, values):
        kinds = [value['kind'] for value in values['vitals']]
        if len(kinds) != len(set(kinds)) or len(json.dumps(values['observations']).encode()) > 5000:
            raise serializers.ValidationError('Duplicate observation kind or excessive observations.')
        return values


class ReviewInput(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    decision = serializers.ChoiceField(choices=['accepted', 'rejected'])
    reason = serializers.CharField(max_length=500)


class CareInput(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    status = serializers.ChoiceField(choices=STATUSES)
    next_action = serializers.ChoiceField(choices=ACTIONS)
    resource_id = serializers.UUIDField(allow_null=True)
    assigned_to = serializers.CharField(max_length=120, allow_blank=True)
    location = serializers.CharField(max_length=120, allow_blank=True)


def validated(request, serializer):
    data = object_body(request, 'clinical_foundation')
    # Reject ownership/status/approval fields rather than silently ignoring them.
    instance = serializer(data=data)
    if set(data) - set(instance.fields):
        raise serializers.ValidationError('Unexpected fields are not allowed.')
    instance.is_valid(raise_exception=True)
    return json.loads(JSONRenderer().render(instance.validated_data))


@api_view(['GET', 'POST'])
def arrivals(request, hospital_id):
    context = hospital_context(request, hospital_id, 'arrival.register')
    if request.method == 'GET':
        return response(rpc(request, 'necms_arrival_options', context=context))
    return response(rpc(request, 'necms_record_arrival', {'p_input': validated(request, ArrivalInput)}, context), 201)


@api_view(['POST'])
def reconcile(request, hospital_id, patient_id):
    context = hospital_context(request, hospital_id, 'identity.reconcile')
    data = validated(request, ReconcileInput)
    rpc(request, 'necms_reconcile_identity', {'p_patient': str(patient_id), 'p_version': data.pop('version'), 'p_input': data}, context)
    return response({'status': 'reconciled'})


@api_view(['GET', 'POST'])
def assessments(request, hospital_id, visit_id):
    if request.method == 'GET':
        context = hospital_context(request, hospital_id, 'triage.read')
        return response(rpc(request, 'necms_assessment_history', {'p_encounter': str(visit_id)}, context))
    # Validate context before parsing clinical input; DB independently checks kind/capability.
    context = hospital_context(request, hospital_id)
    data = validated(request, AssessmentInput)
    hospital_context(request, hospital_id, 'triage.create' if data['kind'] == 'initial' else 'triage.reassess')
    return response({'id': rpc(request, 'necms_record_assessment', {'p_encounter': str(visit_id), 'p_version': data.pop('version'), 'p_input': data}, context)}, 201)


@api_view(['POST'])
def review(request, hospital_id, assessment_id):
    context = hospital_context(request, hospital_id, 'triage.review')
    data = validated(request, ReviewInput)
    rpc(request, 'necms_review_assessment', {'p_assessment': str(assessment_id), 'p_version': data['version'], 'p_decision': data['decision'], 'p_reason': data['reason']}, context)
    return response({'status': 'reviewed'})


@api_view(['GET'])
def timeline(request, hospital_id, visit_id):
    context = hospital_context(request, hospital_id, 'clinical.timeline.read')
    return response(rpc(request, 'necms_clinical_timeline', {'p_encounter': str(visit_id)}, context))


@api_view(['POST'])
def care(request, hospital_id, visit_id):
    context = hospital_context(request, hospital_id, 'encounter.update_legacy')
    data = validated(request, CareInput)
    rpc(request, 'necms_update_care', {'p_encounter': str(visit_id), 'p_version': data.pop('version'), 'p_input': data}, context)
    return response({'status': 'updated'})


class ProtocolInput(serializers.Serializer):
    protocol_identifier = serializers.CharField(max_length=100)
    version = serializers.CharField(max_length=50)


@api_view(['POST'])
def protocol_draft(request, hospital_id):
    context = hospital_context(request, hospital_id, 'protocol.admin')
    data = validated(request, ProtocolInput)
    return response({'id': rpc(request, 'necms_register_protocol', {'p_identifier': data['protocol_identifier'], 'p_version': data['version']}, context)}, 201)
