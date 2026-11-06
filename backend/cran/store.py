"""Storage for the CRAN demo: FHIR resources stored whole, as JSON documents.

Why JSONB documents rather than new typed tables: the existing PatientFlow schema
is a typed, RLS-protected, multi-hospital model used by a live pilot. The demo must
not alter it. Storing whole FHIR R4 resources (one row per resource, keyed by type
and id) keeps the FHIR shape exact on read and write, needs one additive table, and
can sit in a separate Supabase project. The mappers in fhir.py are the only place
that knows the resource shape.

Two interchangeable backends:
- FileStore (default, `CRAN_STORE=file`): a local JSON file. Used for the stage demo
  so it runs with one command and no network.
- SupabaseStore (`CRAN_STORE=supabase`): the `fhir_resources` and `cran_records`
  tables from supabase/cran-demo/cran_demo_schema.sql, through the Data API.
  Only for a separate, synthetic-only demo project (never the pilot project).
"""
from __future__ import annotations

import copy
import json
import os
import threading
from pathlib import Path

import httpx
from django.conf import settings

from .fhir import new_id, now_iso


class Store:
    def get(self, rtype: str, rid: str) -> dict | None: raise NotImplementedError
    def put(self, resource: dict) -> dict: raise NotImplementedError
    def all(self, rtype: str) -> list[dict]: raise NotImplementedError
    def add_record(self, kind: str, data: dict) -> dict: raise NotImplementedError
    def records(self, kind: str) -> list[dict]: raise NotImplementedError
    def update_record(self, kind: str, rid: str, changes: dict) -> dict | None: raise NotImplementedError
    def get_meta(self, key: str, default=None): raise NotImplementedError
    def set_meta(self, key: str, value) -> None: raise NotImplementedError
    def replace_all(self, resources: list[dict], records: dict[str, list[dict]], meta: dict) -> None: raise NotImplementedError
    def version(self) -> int: raise NotImplementedError

    def search(self, rtype: str, predicate) -> list[dict]:
        return [r for r in self.all(rtype) if predicate(r)]


class FileStore(Store):
    """Thread-safe JSON file store. `path=None` keeps everything in memory (tests)."""

    def __init__(self, path: str | Path | None):
        self.path = Path(path) if path else None
        self.lock = threading.RLock()
        self.data = {'resources': {}, 'records': {}, 'meta': {}, 'version': 0}
        if self.path and self.path.exists():
            self.data = json.loads(self.path.read_text(encoding='utf-8'))

    def _save(self):
        self.data['version'] += 1
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.data), encoding='utf-8')
            os.replace(tmp, self.path)

    def get(self, rtype, rid):
        with self.lock:
            found = self.data['resources'].get(rtype, {}).get(rid)
            return copy.deepcopy(found) if found else None

    def put(self, resource):
        with self.lock:
            resource = copy.deepcopy(resource)
            resource.setdefault('meta', {})['lastUpdated'] = now_iso()
            self.data['resources'].setdefault(resource['resourceType'], {})[resource['id']] = resource
            self._save()
            return copy.deepcopy(resource)

    def all(self, rtype):
        with self.lock:
            return copy.deepcopy(list(self.data['resources'].get(rtype, {}).values()))

    def add_record(self, kind, data):
        with self.lock:
            record = {'id': new_id(), 'created_at': now_iso(), **copy.deepcopy(data)}
            self.data['records'].setdefault(kind, []).append(record)
            self._save()
            return copy.deepcopy(record)

    def records(self, kind):
        with self.lock:
            return copy.deepcopy(self.data['records'].get(kind, []))

    def update_record(self, kind, rid, changes):
        with self.lock:
            for record in self.data['records'].get(kind, []):
                if record['id'] == rid:
                    record.update(copy.deepcopy(changes))
                    self._save()
                    return copy.deepcopy(record)
            return None

    def get_meta(self, key, default=None):
        with self.lock:
            return copy.deepcopy(self.data['meta'].get(key, default))

    def set_meta(self, key, value):
        with self.lock:
            self.data['meta'][key] = copy.deepcopy(value)
            self._save()

    def replace_all(self, resources, records, meta):
        with self.lock:
            stamp = now_iso()
            by_type: dict = {}
            for resource in resources:
                resource = copy.deepcopy(resource)
                resource.setdefault('meta', {})['lastUpdated'] = stamp
                by_type.setdefault(resource['resourceType'], {})[resource['id']] = resource
            self.data = {'resources': by_type, 'records': copy.deepcopy(records), 'meta': copy.deepcopy(meta),
                         'version': self.data.get('version', 0)}
            self._save()

    def version(self):
        with self.lock:
            return self.data['version']


class SupabaseStore(Store):
    """Same interface over Supabase's Data API (anon role on a synthetic-only demo project)."""

    def __init__(self, url: str, key: str):
        self.base = url.rstrip('/') + '/rest/v1'
        self.headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def _request(self, method, table, *, params=None, body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers['Prefer'] = prefer
        response = httpx.request(method, f'{self.base}/{table}', headers=headers, params=params, json=body,
                                 timeout=httpx.Timeout(10.0, connect=5.0))
        response.raise_for_status()
        return response.json() if response.content else None

    def get(self, rtype, rid):
        rows = self._request('GET', 'fhir_resources', params={'select': 'resource', 'resource_type': f'eq.{rtype}', 'id': f'eq.{rid}'})
        return rows[0]['resource'] if rows else None

    def put(self, resource):
        resource = copy.deepcopy(resource)
        resource.setdefault('meta', {})['lastUpdated'] = now_iso()
        self._request('POST', 'fhir_resources', body={'id': resource['id'], 'resource_type': resource['resourceType'], 'resource': resource},
                      prefer='resolution=merge-duplicates')
        return resource

    def all(self, rtype):
        rows = self._request('GET', 'fhir_resources', params={'select': 'resource', 'resource_type': f'eq.{rtype}'})
        return [row['resource'] for row in rows]

    def add_record(self, kind, data):
        record = {'id': new_id(), 'created_at': now_iso(), **data}
        self._request('POST', 'cran_records', body={'id': record['id'], 'kind': kind, 'data': record})
        return record

    def records(self, kind):
        rows = self._request('GET', 'cran_records', params={'select': 'data', 'kind': f'eq.{kind}', 'order': 'created_at.asc'})
        return [row['data'] for row in rows]

    def update_record(self, kind, rid, changes):
        current = next((r for r in self.records(kind) if r['id'] == rid), None)
        if current is None:
            return None
        current.update(changes)
        self._request('PATCH', 'cran_records', params={'id': f'eq.{rid}'}, body={'data': current})
        return current

    def get_meta(self, key, default=None):
        rows = self._request('GET', 'cran_records', params={'select': 'data', 'kind': 'eq.meta', 'id': f'eq.meta-{key}'})
        return rows[0]['data']['value'] if rows else default

    def set_meta(self, key, value):
        self._request('POST', 'cran_records', body={'id': f'meta-{key}', 'kind': 'meta', 'data': {'value': value}},
                      prefer='resolution=merge-duplicates')

    def replace_all(self, resources, records, meta):
        self._request('DELETE', 'fhir_resources', params={'id': 'not.is.null'})
        self._request('DELETE', 'cran_records', params={'id': 'not.is.null'})
        stamp = now_iso()
        rows = []
        for resource in resources:
            resource = copy.deepcopy(resource)
            resource.setdefault('meta', {})['lastUpdated'] = stamp
            rows.append({'id': resource['id'], 'resource_type': resource['resourceType'], 'resource': resource})
        for start in range(0, len(rows), 200):
            self._request('POST', 'fhir_resources', body=rows[start:start + 200])
        record_rows = [{'id': r['id'], 'kind': kind, 'data': r} for kind, items in records.items() for r in items]
        if record_rows:
            self._request('POST', 'cran_records', body=record_rows)
        for key, value in meta.items():
            self.set_meta(key, value)

    def version(self):
        return 0  # The frontend relies on Supabase Realtime for change notification in this mode.


_store: Store | None = None
_lock = threading.Lock()


def get_store() -> Store:
    global _store
    with _lock:
        if _store is None:
            if settings.CRAN_STORE == 'supabase':
                _store = SupabaseStore(settings.CRAN_SUPABASE_URL, settings.CRAN_SUPABASE_KEY)
            elif settings.CRAN_STORE == 'memory':
                _store = FileStore(None)
            else:
                _store = FileStore(settings.CRAN_DATA_FILE)
        return _store


def use_store(store: Store | None) -> None:
    """Swap the active store (tests)."""
    global _store
    with _lock:
        _store = store
