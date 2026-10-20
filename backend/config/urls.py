from django.urls import path
from patients import views
from patients import necms_views as necms
from patients import clinical_views as clinical
from patients import coordination_views as coordination
from patients import paged_views as paged

urlpatterns = [
    path('api/necms/hospitals/<uuid:hospital_id>/read/<str:kind>/', paged.page),
    path('api/necms/hospitals/<uuid:hospital_id>/workspace/', paged.workspace),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/', coordination.board),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/work-items/', coordination.create),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/work-items/<uuid:work_id>/events/', coordination.event),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/encounters/<uuid:visit_id>/events/', coordination.history),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/exceptions/<uuid:exception_id>/review/', coordination.review),
    path('api/necms/hospitals/<uuid:hospital_id>/coordination/configuration/', coordination.configuration),
    path('api/necms/hospitals/<uuid:hospital_id>/arrivals/', clinical.arrivals),
    path('api/necms/hospitals/<uuid:hospital_id>/patients/<uuid:patient_id>/reconcile/', clinical.reconcile),
    path('api/necms/hospitals/<uuid:hospital_id>/visits/<uuid:visit_id>/assessments/', clinical.assessments),
    path('api/necms/hospitals/<uuid:hospital_id>/visits/<uuid:visit_id>/timeline/', clinical.timeline),
    path('api/necms/hospitals/<uuid:hospital_id>/visits/<uuid:visit_id>/care/', clinical.care),
    path('api/necms/hospitals/<uuid:hospital_id>/assessments/<uuid:assessment_id>/review/', clinical.review),
    path('api/necms/hospitals/<uuid:hospital_id>/triage-protocols/', clinical.protocol_draft),
    path('api/necms/hospitals/', necms.hospitals),
    path('api/necms/contexts/', necms.contexts),
    path('api/necms/hospitals/<uuid:hospital_id>/board/', necms.board),
    path('api/necms/hospitals/<uuid:hospital_id>/history/', necms.history),
    path('api/necms/hospitals/<uuid:hospital_id>/display-board/', necms.display_board),
    path('api/necms/hospitals/<uuid:hospital_id>/visits/', necms.visit),
    path('api/necms/hospitals/<uuid:hospital_id>/visits/<uuid:visit_id>/', necms.visit),
    path('api/necms/hospitals/<uuid:hospital_id>/resources/<uuid:resource_id>/', necms.resource),
    path('api/necms/hospitals/<uuid:hospital_id>/staff/', necms.staff),
    path('api/necms/hospitals/<uuid:hospital_id>/configuration/', necms.configuration),
    path('api/health/', views.health),
    path('api/board/', views.board),
    path('api/visits/', views.create_visit),
    path('api/visits/<uuid:visit_id>/', views.update_visit),
    path('api/resources/<uuid:resource_id>/', views.update_resource),
]
