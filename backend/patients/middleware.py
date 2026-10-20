from django.utils.cache import patch_vary_headers


class ClinicalCacheControl:
    """Also covers non-DRF errors/404s; no clinical API response is cacheable."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        result = self.get_response(request)
        if request.path.startswith('/api/'):
            result['Cache-Control'] = 'no-store'
            result['Pragma'] = 'no-cache'
            patch_vary_headers(result, ['Authorization', 'X-NECMS-Context'])
        return result
