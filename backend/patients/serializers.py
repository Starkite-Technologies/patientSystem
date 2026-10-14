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
