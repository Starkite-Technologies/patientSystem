from rest_framework import serializers
from django.utils import timezone

STATUSES = ['waiting', 'ready', 'in_treatment', 'awaiting_results', 'observation', 'discharged', 'transferred']
ACTIONS = ['assessment', 'imaging', 'laboratory', 'treatment', 'surgery', 'admission', 'none']


class StrictIntegerField(serializers.IntegerField):
    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail('invalid')
        return super().to_internal_value(data)


class VisitInputSerializer(serializers.Serializer):
    patient_ref = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=160)
    last_name = serializers.CharField(max_length=160)
    date_of_birth = serializers.DateField(allow_null=True)
    complaint = serializers.CharField(max_length=300)
    priority = StrictIntegerField(min_value=1, max_value=5)
    status = serializers.ChoiceField(choices=STATUSES)
    next_action = serializers.ChoiceField(choices=ACTIONS)
    location = serializers.CharField(max_length=120, allow_blank=True)
    resource_id = serializers.UUIDField(allow_null=True)
    assigned_to = serializers.CharField(max_length=120, allow_blank=True)
    notes = serializers.CharField(max_length=2000, allow_blank=True)


    def validate_date_of_birth(self, value):
        if value is not None and value > timezone.localdate():
            raise serializers.ValidationError('Date of birth cannot be in the future.')
        return value


class VisitRequestSerializer(serializers.Serializer):
    input = VisitInputSerializer()
    request_id = serializers.UUIDField(required=False)


class VisitUpdateSerializer(VisitRequestSerializer):
    version = StrictIntegerField(min_value=1)
    patient_version = StrictIntegerField(min_value=1)


class ResourceSerializer(serializers.Serializer):
    state = serializers.ChoiceField(choices=['available', 'cleaning', 'unavailable'])


ACTIVE_STATUSES = STATUSES[:5]
COMPLETED_STATUSES = STATUSES[5:]


class ExportQuerySerializer(serializers.Serializer):
    # Mirrors the board filters; dates are arrival dates in the hospital time zone.
    # Theatre scope: dates are decision-to-operate dates; ED filters do not apply.
    scope = serializers.ChoiceField(choices=['board', 'completed', 'theatre'])
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    q = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    priority = StrictIntegerField(min_value=1, max_value=5, required=False)
    status = serializers.ChoiceField(choices=STATUSES, required=False)
    action = serializers.ChoiceField(choices=ACTIONS, required=False)

    def validate(self, data):
        if data.get('date_to') and data['date_to'].year == 9999:
            raise serializers.ValidationError('The end date must be before year 9999.')
        if data.get('date_from') and data.get('date_to') and data['date_from'] > data['date_to']:
            raise serializers.ValidationError('The start date must be on or before the end date.')
        if data['scope'] == 'theatre':
            if any(data.get(key) for key in ('priority', 'status', 'action')):
                raise serializers.ValidationError('Those filters do not apply to the theatre list.')
            return data
        allowed = ACTIVE_STATUSES if data['scope'] == 'board' else COMPLETED_STATUSES
        if data.get('status') and data['status'] not in allowed:
            raise serializers.ValidationError('That status is not part of this view.')
        return data


SPECIALTIES = ['General Surgery', 'Orthopaedics', 'Obstetrics and Gynaecology', 'Neurosurgery', 'Urology', 'ENT',
               'Maxillofacial Surgery', 'Vascular Surgery', 'Paediatric Surgery', 'Cardiothoracic Surgery', 'Plastic Surgery']
CONSEQUENCES = ['death', 'limb_organ', 'sepsis', 'bowel', 'neurological', 'pain', 'other']
DELAY_CATEGORIES = ['theatre_capacity', 'anaesthetist', 'surgeon', 'patient_optimisation', 'investigations', 'blood_bank',
                    'equipment', 'critical_care_bed', 'transport', 'competing_emergency', 'administrative', 'other']
PRIORITY_CODE = r'^P[0-9]$'


class TheatreCaseFields(serializers.Serializer):
    # Optional everywhere; the database decides which fields are required for a full or rapid booking.
    mrn = serializers.CharField(max_length=40, required=False, allow_blank=True)
    sex = serializers.ChoiceField(choices=['female', 'male', 'other', 'unknown'], required=False)
    location = serializers.CharField(max_length=120, required=False)
    specialty = serializers.ChoiceField(choices=SPECIALTIES, required=False, allow_blank=True)
    responsible_consultant = serializers.CharField(max_length=120, required=False, allow_blank=True)
    diagnosis = serializers.CharField(max_length=300, required=False, allow_blank=True)
    proposed_operation = serializers.CharField(max_length=300, required=False)
    indication = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    delay_consequence = serializers.ChoiceField(choices=CONSEQUENCES, required=False, allow_blank=True)
    decision_at = serializers.DateTimeField(required=False)
    estimated_minutes = StrictIntegerField(min_value=10, max_value=1440, required=False, allow_null=True)
    haemodynamically_unstable = serializers.BooleanField(required=False, allow_null=True)
    septic_shock = serializers.BooleanField(required=False, allow_null=True)
    organ_support = serializers.BooleanField(required=False, allow_null=True)
    anaesthetic_concern = serializers.BooleanField(required=False, allow_null=True)


class TheatreBookingInput(TheatreCaseFields):
    rapid = serializers.BooleanField(required=False, default=False)
    patient_id = serializers.UUIDField(required=False, allow_null=True)
    visit_id = serializers.UUIDField(required=False, allow_null=True)
    first_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    priority_code = serializers.RegexField(PRIORITY_CODE, required=False)

    def validate(self, data):
        if not data.get('patient_id') and not (data.get('first_name', '').strip() and data.get('last_name', '').strip()):
            raise serializers.ValidationError('Choose a patient or enter a first and last name.')
        if not data.get('proposed_operation', '').strip() or not data.get('location', '').strip():
            raise serializers.ValidationError("Enter the proposed operation and the patient's location.")
        return data


class TheatreUpdateInput(TheatreCaseFields):
    ready_for_theatre = serializers.BooleanField(required=False)
    theatre_id = serializers.UUIDField(required=False, allow_null=True)
    planned_start = serializers.DateTimeField(required=False, allow_null=True)
    delay_category = serializers.ChoiceField(choices=DELAY_CATEGORIES, required=False, allow_null=True)
    delay_note = serializers.CharField(max_length=500, required=False, allow_blank=True)


class TheatreBookingRequest(serializers.Serializer):
    input = TheatreBookingInput()


class TheatreUpdateRequest(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    input = TheatreUpdateInput()


class TheatrePriorityRequest(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    code = serializers.RegexField(PRIORITY_CODE)
    reason = serializers.CharField(min_length=5, max_length=500)


class TheatreTimeRequest(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    event = serializers.ChoiceField(choices=['anaesthesia', 'incision', 'completed'])
    at = serializers.DateTimeField(required=False, allow_null=True)


class TheatreCancelRequest(serializers.Serializer):
    version = StrictIntegerField(min_value=1)
    reason = serializers.CharField(min_length=5, max_length=500)
    authorised_by = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
