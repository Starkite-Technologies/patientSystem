import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Read-only check of Supabase reachability and PatientFlow schema availability.'

    def handle(self, *args, **options):
        if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
            raise CommandError('Configure the project URL and publishable key.')
        try:
            with httpx.Client(base_url=settings.SUPABASE_URL, headers={'apikey': settings.SUPABASE_PUBLISHABLE_KEY}, timeout=10) as client:
                auth = client.get('/auth/v1/settings')
                if auth.status_code != 200:
                    raise CommandError('Supabase Auth did not accept the project configuration.')
                self.stdout.write('Supabase Auth connection verified.')
                result = client.get('/rest/v1/visit_board', params={'select': 'id', 'limit': 0})
                try:
                    code = result.json().get('code') if isinstance(result.json(), dict) else None
                except ValueError:
                    raise CommandError('Supabase Data API returned an unexpected response.') from None
                if code in ('PGRST205', '42P01'):
                    raise CommandError('The normalized PatientFlow schema is missing. Apply the initial and normalize_names SQL migrations in order (skip any already applied).')
                if result.status_code in (401, 403) and code == '42501':
                    self.stdout.write('PatientFlow normalized board view found; anonymous access is blocked as expected.')
                elif result.status_code == 200:
                    raise CommandError('Anonymous table access was allowed. Verify the migration permissions before using patient records.')
                else:
                    raise CommandError('Could not verify PatientFlow table permissions. Check the migration and Data API settings.')
        except httpx.RequestError:
            raise CommandError('Could not reach Supabase. Check network access and project configuration.') from None
