"""Operational coordination only. No executable medical orders or clinical rules."""
from rest_framework import serializers
from rest_framework.decorators import api_view
from .clinical_views import validated
from .necms_views import hospital_context, rpc
from .serializers import StrictIntegerField
from .views import response

KINDS=['initial_review','nursing_reassessment','laboratory','imaging','treatment','transfer_preparation','urgent_review','other']
EVENT_CAPS={'call':'patient.call','call_cancel':'patient.call','accept':'service.accept','acknowledge':'escalation.acknowledge','start':'treatment.record','complete':'work.complete','reassign':'work.assign','defer':'queue.coordinate','resume':'queue.coordinate','cancel':'queue.coordinate','readiness':'queue.coordinate'}

class CreateInput(serializers.Serializer):
    request_id=serializers.UUIDField()
    encounter_id=serializers.UUIDField()
    service_id=serializers.UUIDField()
    kind=serializers.ChoiceField(choices=KINDS)
    title=serializers.CharField(max_length=200)
    eligible=serializers.BooleanField(default=False)
    assignee_id=serializers.UUIDField(allow_null=True,default=None)
    team_id=serializers.UUIDField(allow_null=True,default=None)

class EventInput(serializers.Serializer):
    request_id=serializers.UUIDField()
    version=StrictIntegerField(min_value=1)
    event=serializers.ChoiceField(choices=list(EVENT_CAPS))
    reason=serializers.CharField(max_length=1000,allow_blank=True,default='')
    late_entry_reason=serializers.CharField(max_length=500,allow_blank=True,default='')
    occurred_at=serializers.DateTimeField(required=False)
    reason_category_id=serializers.UUIDField(allow_null=True,default=None)
    assignee_id=serializers.UUIDField(allow_null=True,default=None)
    team_id=serializers.UUIDField(allow_null=True,default=None)
    eligible=serializers.BooleanField(required=False)

    def validate(self,data):
        from django.utils import timezone
        if data['event'] in ('call_cancel','defer','cancel','reassign') and not data['reason'].strip():
            raise serializers.ValidationError('An operational reason is required for this action.')
        if 'occurred_at' in data and (data['occurred_at']>timezone.now() or not data['late_entry_reason'].strip()):
            raise serializers.ValidationError('Earlier occurrence needs an explanation and cannot be in the future.')
        if data['event']=='readiness' and 'eligible' not in data:
            raise serializers.ValidationError('Explicit readiness state required.')
        return data

class ExceptionInput(serializers.Serializer):
    request_id=serializers.UUIDField()
    reason_category_id=serializers.UUIDField()
    explanation=serializers.CharField(max_length=1000)

class ConfigurationInput(serializers.Serializer):
    request_id=serializers.UUIDField()
    kind=serializers.ChoiceField(choices=['service','team','team_member','reason','inactive_policy'])
    code=serializers.RegexField(r'^[a-zA-Z0-9_-]{1,80}$',required=False)
    name=serializers.CharField(max_length=120,required=False)
    team_id=serializers.UUIDField(required=False)
    user_id=serializers.UUIDField(required=False)
    version=serializers.CharField(max_length=50,required=False)
    document_reference=serializers.CharField(max_length=300,required=False)
    def validate(self,data):
        required={'service':['code','name'],'reason':['code','name'],'team':['name'],'team_member':['team_id','user_id'],'inactive_policy':['version','document_reference']}[data['kind']]
        if any(key not in data for key in required): raise serializers.ValidationError('Required catalogue fields are missing.')
        if set(data)-{'kind','request_id',*required}: raise serializers.ValidationError('Fields do not match the configuration type.')
        return data

@api_view(['GET'])
def board(request,hospital_id):
    context=hospital_context(request,hospital_id,'queue.read')
    return response(rpc(request,'necms_coordination_board',context=context))

@api_view(['POST'])
def create(request,hospital_id):
    context=hospital_context(request,hospital_id)
    data=validated(request,CreateInput)
    hospital_context(request,hospital_id,'reassessment.request' if data['kind'] in ('nursing_reassessment','urgent_review') else 'work.create')
    retry=data.pop('request_id')
    return response(rpc(request,'necms_create_work',{'p_input':data,'p_request':retry},context),201)

@api_view(['POST'])
def event(request,hospital_id,work_id):
    context=hospital_context(request,hospital_id)
    data=validated(request,EventInput)
    hospital_context(request,hospital_id,EVENT_CAPS[data['event']])
    return response(rpc(request,'necms_work_event',{'p_work':str(work_id),'p_version':data.pop('version'),'p_event':data.pop('event'),'p_request':data.pop('request_id'),'p_input':data},context))

@api_view(['GET'])
def history(request,hospital_id,visit_id):
    context=hospital_context(request,hospital_id,'queue.read')
    return response(rpc(request,'necms_coordination_history',{'p_encounter':str(visit_id)},context))

@api_view(['POST'])
def review(request,hospital_id,exception_id):
    context=hospital_context(request,hospital_id,'exception.review')
    data=validated(request,ExceptionInput)
    return response(rpc(request,'necms_review_sequence',{'p_exception':str(exception_id),'p_category':data['reason_category_id'],'p_explanation':data['explanation'],'p_request':data['request_id']},context))

@api_view(['POST'])
def configuration(request,hospital_id):
    context=hospital_context(request,hospital_id,'coordination.configure')
    data=validated(request,ConfigurationInput);retry=data.pop('request_id')
    return response(rpc(request,'necms_coordination_configuration',{'p_request':retry,'p_input':data},context),201)
