import getpass

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from patients.demo_data import DEMO_PATIENTS
from patients.gateway import request_supabase, staff_role
from patients.serializers import VisitInputSerializer


class Command(BaseCommand):
    help = 'Register the 10 fictional demo patients using a staff login; skip existing seed markers.'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True, help='Provisioned Supabase staff account email.')

    def handle(self, *args, **options):
        if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
            raise CommandError('Configure the Supabase project URL and publishable key.')
        password = getpass.getpass('Staff password (hidden): ')
        try:
            result = httpx.post(settings.SUPABASE_URL + '/auth/v1/token',
                                params={'grant_type': 'password'},
                                headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY},
                                json={'email': options['email'], 'password': password}, timeout=15)
        except httpx.RequestError:
            raise CommandError('Could not reach Supabase Auth. No patients were inserted.') from None
        finally:
            password = None
        try:
            login = result.json()
        except ValueError:
            raise CommandError('Unexpected sign-in response. No patients were inserted.') from None
        if result.is_error or not login.get('access_token'):
            if login.get('error_code') == 'email_not_confirmed':
                raise CommandError('Confirm the account email before running the seed command. No patients were inserted.')
            raise CommandError('Staff sign-in failed. Check the credentials and email confirmation. No patients were inserted.')
        token = login['access_token']
        try:
            if staff_role(token, login['user']['id']) not in ('nurse', 'surgeon', 'clinician', 'coordinator'):
                raise CommandError('A clinical staff account is required. No patients were inserted.')
            # Confirms the DOB view exists and checks only explicitly marked fixtures.
            existing = request_supabase('GET', '/rest/v1/visit_board', token, params={
                'select': 'id,patient_ref,notes,date_of_birth', 'notes': 'like.PatientFlow demo seed:*',
            })
            markers = {row['notes'].split('.')[0] for row in existing}
            created = skipped = 0
            for index, (first, last, dob, complaint, priority, status, service, location) in enumerate(DEMO_PATIENTS, 1):
                marker = f'PatientFlow demo seed: {index:02d}'
                if marker in markers:
                    skipped += 1
                    self.stdout.write(f'Skipped existing fictional patient: {first} {last}')
                    continue
                values = {
                    'patient_ref': '', 'first_name': first, 'last_name': last, 'date_of_birth': dob,
                    'complaint': complaint, 'priority': priority, 'status': status, 'next_action': service,
                    'location': location, 'resource_id': None, 'assigned_to': '',
                    'notes': marker + '. Fictional test patient. Priority is a demo value.',
                }
                serializer = VisitInputSerializer(data=values)
                serializer.is_valid(raise_exception=True)
                saved_id = request_supabase('POST', '/rest/v1/rpc/save_visit', token, body={
                    'p_input': values, 'p_id': None, 'p_version': None, 'p_patient_version': None,
                })
                created += 1
                self.stdout.write(self.style.SUCCESS(f'Created fictional patient: {first} {last} (visit {saved_id})'))
            self.stdout.write(self.style.SUCCESS(f'Finished: {created} created, {skipped} already present.'))
        except APIException as error:
            raise CommandError(f'Seeding stopped: {error.detail}. Earlier successful inserts remain; rerun to skip their seed markers.') from None
        finally:
            token = None
