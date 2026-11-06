from django.urls import path

from . import views

urlpatterns = [
    # HL7 FHIR R4 API
    path('fhir/metadata', views.fhir_metadata),
    path('fhir/Patient', views.fhir_patient_search),
    path('fhir/Patient/<str:patient_id>', views.fhir_patient_read),
    path('fhir/Encounter', views.fhir_encounter_create),
    path('fhir/Observation', views.fhir_observation_create),
    path('fhir/Encounter/<str:encounter_id>/$everything', views.fhir_encounter_everything),
    # Mock national registry (demo)
    path('mock-mpi/fhir/Patient', views.mock_mpi_search),
    # Demo application API
    path('api/cran/state/', views.state),
    path('api/cran/lookup/', views.lookup),
    path('api/cran/patients/', views.register),
    path('api/cran/arrivals/', views.arrival),
    path('api/cran/encounters/<str:encounter_id>/', views.encounter),
    path('api/cran/encounters/<str:encounter_id>/triage/', views.triage),
    path('api/cran/encounters/<str:encounter_id>/retriage/', views.retriage),
    path('api/cran/encounters/<str:encounter_id>/vitals/', views.vitals),
    path('api/cran/encounters/<str:encounter_id>/treat/', views.treat),
    path('api/cran/encounters/<str:encounter_id>/close/', views.close),
    path('api/cran/encounters/<str:encounter_id>/notes/draft/', views.note_draft),
    path('api/cran/encounters/<str:encounter_id>/notes/', views.note_sign),
    path('api/cran/alerts/<str:alert_id>/', views.alert),
    path('api/cran/handover/', views.handover),
    path('api/cran/dashboard/', views.dashboard),
    path('api/cran/help/', views.help_answer),
    path('api/cran/audit/', views.audit),
    path('api/cran/directory/', views.directory),
    path('api/cran/export/<str:kind>/', views.export),
    path('api/cran/demo/reset/', views.reset),
    path('api/cran/demo/trigger/', views.trigger),
]
