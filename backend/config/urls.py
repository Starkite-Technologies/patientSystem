from django.urls import path
from patients import views

urlpatterns = [
    path('api/health/', views.health),
    path('api/board/', views.board),
    path('api/visits/', views.create_visit),
    path('api/visits/<uuid:visit_id>/', views.update_visit),
    path('api/resources/<uuid:resource_id>/', views.update_resource),
]
