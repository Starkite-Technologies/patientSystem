from rest_framework.exceptions import APIException


class UpstreamUnavailable(APIException):
    status_code = 503
    default_detail = 'Supabase is unavailable. Please try again.'


class WorkflowConflict(APIException):
    status_code = 409


def api_exception_handler(exc, context):
    from rest_framework.views import exception_handler
    response = exception_handler(exc, context)
    if response is not None:
        response['Cache-Control'] = 'no-store'
    return response
