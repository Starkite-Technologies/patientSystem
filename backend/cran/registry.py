"""All national-registry access goes through NationalRegistryConnector.

Swapping the mock for a real MoHSS registry is a configuration change:
  REGISTRY_CONNECTOR=mock        -> MockConnector (in-process mock MPI, default)
  REGISTRY_CONNECTOR=fhir-http   -> FhirHttpConnector against REGISTRY_BASE_URL
                                    (any FHIR R4 server exposing Patient search
                                    and Patient/$everything), with REGISTRY_TOKEN.
"""
from __future__ import annotations

import httpx
from django.conf import settings

from mock_mpi import service as mock_mpi

from . import fhir


class RegistryUnavailable(Exception):
    pass


class NationalRegistryConnector:
    label = 'National registry'

    def lookup(self, identifier: str) -> dict | None:
        """Return a FHIR Bundle (Patient first, then history), or None if not registered."""
        raise NotImplementedError

    def prefill(self, identifier: str) -> dict | None:
        """Optional demographics for an unregistered ID (e.g. read from an ID card)."""
        return None


class MockConnector(NationalRegistryConnector):
    label = 'National registry (demo mock)'

    def lookup(self, identifier):
        return mock_mpi.lookup(identifier)

    def prefill(self, identifier):
        return mock_mpi.new_person(identifier)


class FhirHttpConnector(NationalRegistryConnector):
    label = 'National registry'

    def __init__(self, base_url: str, token: str = ''):
        self.base = base_url.rstrip('/')
        self.headers = {'Accept': 'application/fhir+json', **({'Authorization': f'Bearer {token}'} if token else {})}

    def lookup(self, identifier):
        try:
            search = httpx.get(f'{self.base}/Patient', params={'identifier': identifier}, headers=self.headers, timeout=8)
            search.raise_for_status()
            entries = search.json().get('entry', [])
            if not entries:
                return None
            pid = entries[0]['resource']['id']
            everything = httpx.get(f'{self.base}/Patient/{pid}/$everything', headers=self.headers, timeout=8)
            everything.raise_for_status()
            return everything.json()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise RegistryUnavailable(str(exc)) from None


def get_connector() -> NationalRegistryConnector:
    if settings.REGISTRY_CONNECTOR == 'fhir-http':
        return FhirHttpConnector(settings.REGISTRY_BASE_URL, settings.REGISTRY_TOKEN)
    return MockConnector()


def history(bundle: dict) -> dict:
    """Flatten a registry Bundle into {patient, encounters, conditions, allergies} for the UI and AI."""
    resources = [e['resource'] for e in bundle.get('entry', [])]
    patient = next(r for r in resources if r['resourceType'] == 'Patient')
    return {
        'patient': patient,
        'encounters': [{'date': r['period']['start'][:10], 'facility': (r.get('serviceProvider') or {}).get('display', ''),
                        'reason': ((r.get('reasonCode') or [{}])[0]).get('text', '')}
                       for r in resources if r['resourceType'] == 'Encounter'],
        'conditions': [r['code']['text'] for r in resources if r['resourceType'] == 'Condition'],
        'allergies': [r['code']['text'] for r in resources if r['resourceType'] == 'AllergyIntolerance'],
    }


def errors_in(bundle: dict) -> list[str]:
    return fhir.validate(bundle)
