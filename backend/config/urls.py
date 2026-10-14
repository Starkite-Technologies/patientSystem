from django.urls import path
from patients import views
from patients import necms_views as necms

urlpatterns = [
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
