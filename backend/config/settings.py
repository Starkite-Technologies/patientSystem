import os
from pathlib import Path
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / '.env.local')
load_dotenv(ROOT_DIR / '.env')

DEBUG = os.getenv('DJANGO_DEBUG', 'false').lower() == 'true'
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'local-development-only-do-not-deploy'
    else:
        raise ImproperlyConfigured('Set DJANGO_SECRET_KEY, or use DJANGO_DEBUG=true for local development.')
ALLOWED_HOSTS = [h.strip() for h in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',') if h.strip()]
INSTALLED_APPS = ['rest_framework', 'patients']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'patients.middleware.ClinicalCacheControl', 'django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
# Existing application tables remain owned by the Supabase SQL migrations.
# This backend accesses Postgres through Supabase's RLS-aware Data API.
DATABASES = {'default': {'ENGINE': 'django.db.backends.dummy'}}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'Africa/Johannesburg'
APPEND_SLASH = False
NECMS_ENABLED = os.getenv('NECMS_ENABLED', 'false').lower() == 'true'
DATA_UPLOAD_MAX_MEMORY_SIZE = 65536
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['patients.authentication.SupabaseAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
    'UNAUTHENTICATED_USER': None,
    'EXCEPTION_HANDLER': 'patients.exceptions.api_exception_handler',
}
SUPABASE_URL = os.getenv('SUPABASE_URL') or os.getenv('VITE_SUPABASE_URL', '')
SUPABASE_URL = SUPABASE_URL.rstrip('/')
SUPABASE_PUBLISHABLE_KEY = os.getenv('SUPABASE_PUBLISHABLE_KEY') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
if SUPABASE_URL and urlparse(SUPABASE_URL).scheme != 'https':
    raise ImproperlyConfigured('SUPABASE_URL must be an HTTPS project URL.')
from patients.key_safety import public_key_allowed
if not public_key_allowed(SUPABASE_PUBLISHABLE_KEY):
    raise ImproperlyConfigured('Use a publishable key for the user-scoped Supabase gateway.')
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = os.getenv('DJANGO_SECURE_SSL_REDIRECT', 'false').lower() == 'true'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
