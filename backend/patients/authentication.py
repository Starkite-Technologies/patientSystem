from dataclasses import dataclass
from uuid import UUID

from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .gateway import request_supabase


@dataclass(frozen=True)
class StaffUser:
    id: str
    is_authenticated: bool = True


class SupabaseAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header:
            return None
        if len(header) != 2 or header[0].lower() != b'bearer':
            raise AuthenticationFailed('A valid Bearer session is required.')
        try:
            token = header[1].decode('ascii')
        except UnicodeDecodeError:
            raise AuthenticationFailed('Invalid staff session.') from None
        if len(token) > 8192:
            raise AuthenticationFailed('Invalid staff session.')
        # Validate with Supabase Auth; never trust a merely decoded JWT.
        user = request_supabase('GET', '/auth/v1/user', token)
        try:
            user_id = str(UUID(user['id']))
        except (TypeError, KeyError, ValueError):
            raise AuthenticationFailed('Invalid staff session.') from None
        return StaffUser(user_id), token

    def authenticate_header(self, request):
        return 'Bearer'
