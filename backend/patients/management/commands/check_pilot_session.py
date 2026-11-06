"""Interactive staff login and fictional-only export acceptance check."""
import csv
import getpass
import io

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Prompt securely for staff login; check the running pilot and export only explicitly marked fictional visits.'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True)
        parser.add_argument('--marker', default='PILOT-FICTIONAL-20261026')

    def handle(self, *args, **options):
        if settings.NECMS_ENABLED:
            raise CommandError('This acceptance check is for the single-department pilot.')
        marker = options['marker']
        if not marker.startswith('PILOT-FICTIONAL-') or len(marker) < 20:
            raise CommandError('Use a unique PILOT-FICTIONAL- marker in the fictional presenting complaint.')
        password = getpass.getpass('Staff password (hidden): ')
        token = None
        try:
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                login = client.post(settings.SUPABASE_URL + '/auth/v1/token', params={'grant_type': 'password'},
                                    headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY},
                                    json={'email': options['email'], 'password': password})
                password = None
                if login.status_code != 200:
                    raise CommandError('Staff sign-in failed. No export was requested.')
                token = login.json().get('access_token')
                if not token:
                    raise CommandError('Auth did not return a session. No export was requested.')
                headers = {'Authorization': f'Bearer {token}'}
                # The running proxy/backend, rather than a mocked gateway.
                base = 'http://127.0.0.1:4173'
                result = client.get(base + '/api/board/', headers=headers)
                if result.status_code != 200:
                    raise CommandError('Login succeeded but the staff board was refused. Check staff provisioning.')
                board = result.json()
                role = board['role']
                self.stdout.write(f'Staff sign-in and board access verified. Role: {role}.')
                if role != 'coordinator':
                    denied = client.get(base + '/api/export/', params={'scope': 'board', 'q': marker}, headers=headers)
                    if denied.status_code != 403:
                        raise CommandError('Expected non-coordinator export refusal.')
                    self.stdout.write(self.style.SUCCESS('Non-coordinator export correctly refused.'))
                    return
                matching = [r for r in board['visits'] if marker.lower() in ' '.join(str(r.get(k) or '') for k in
                            ('patient_ref', 'first_name', 'last_name', 'complaint', 'assigned_to', 'location')).lower()
                            and r['status'] in ('waiting', 'ready', 'in_treatment', 'awaiting_results', 'observation')]
                if not matching or any(marker not in (r.get('complaint') or '') for r in matching):
                    raise CommandError('Register an active fictional patient with the unique marker in the presenting complaint first. No export requested.')
                before = {e['id'] for e in board['events']}
                result = client.get(base + '/api/export/', params={'scope': 'board', 'q': marker}, headers=headers)
                if result.status_code != 200 or not result.headers.get('content-type', '').startswith('text/csv'):
                    raise CommandError('The running export endpoint failed. No CSV was saved.')
                rows = list(csv.DictReader(io.StringIO(result.content.decode('utf-8-sig'))))
                if not rows or any(marker not in r.get('Presenting complaint', '') for r in rows):
                    raise CommandError('Export did not contain only the marked fictional visits.')
                refreshed = client.get(base + '/api/board/', headers=headers)
                refreshed.raise_for_status()
                refs = {r['Patient reference'] for r in rows}
                events = [e for e in refreshed.json()['events'] if e['id'] not in before and e['action'] == 'exported']
                if not any(all(ref in e['summary'] for ref in refs) for e in events):
                    raise CommandError('CSV returned but a matching new Activity log event was not visible.')
                self.stdout.write(self.style.SUCCESS(f'Export and new Activity log event verified for {len(rows)} fictional visit(s). CSV discarded; no patient data saved.'))
        except (httpx.HTTPError, ValueError, KeyError):
            raise CommandError('The running pilot returned an unexpected response or could not be reached.') from None
        finally:
            password = None
            if token:
                try:
                    httpx.post(settings.SUPABASE_URL + '/auth/v1/logout', params={'scope': 'local'},
                               headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY, 'Authorization': f'Bearer {token}'}, timeout=10)
                except httpx.HTTPError:
                    pass
            token = None
