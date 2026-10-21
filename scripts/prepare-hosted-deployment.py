"""Target-specific recovery/deployment operator. No credentials or patient values logged.

Default: encrypted application backup + disposable local recovery rehearsal only.
--execute: use that verified backup/plan to deploy the reviewed seven migrations.
Requires the user's explicit original-project/synthetic-data authorisation.
No hosted reset, seed, historical ownership assignment or RLS disabling.
"""
import argparse
import ctypes
from ctypes import wintypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
REF = 'znltmxajrztszhjuamak'
LOCAL = Path(tempfile.gettempdir()) / 'necms-3c-postgresql'
ARTIFACTS = ROOT / 'test-results/supabase-verification'
TABLES = ['staff_profiles', 'patients', 'resources', 'visits', 'audit_events',
          'patient_age_migration_archive', 'patient_name_migration_archive']
CLI = ['node', str(ROOT / 'node_modules/supabase/dist/supabase.js')]


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def hosted(sql):
    # All SQL is generated from reviewed repository files or catalogue identifiers.
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',suffix='.sql',dir=ARTIFACTS,delete=False) as file:
        file.write(sql);query_path=Path(file.name)
    try:
        r = subprocess.run(CLI + ['db', 'query', '--linked', '--project-ref', REF,
                                 '--output', 'json', '--file', str(query_path)], cwd=ROOT, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
    finally:
        assert query_path.resolve().parent==ARTIFACTS.resolve()
        query_path.unlink()
    if r.returncode:
        # SQL diagnostics can include row contents; never echo them.
        text=(r.stdout+'\n'+r.stderr).lower()
        categories=[x for x in ['syntax error','permission denied','read-only','timeout','unauthorized','forbidden','not found'] if x in text]
        raise RuntimeError('Hosted operation failed; diagnostic categories: '+','.join(categories)+'; raw diagnostics withheld')
    return json.loads(r.stdout)['rows']


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise RuntimeError('Windows per-user backup protection failed')
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(ctypes.cast(outgoing.data, ctypes.c_void_p))


def projection(table, columns):
    allowed = ','.join(literal(c) for c in columns[table])
    return ("select (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(t)) kv(k,v) "
            f"where k in ({allowed})) as row from public.{table} t")


def digest_sql(table, columns):
    return ("select jsonb_build_object('count',count(*),'digest',"
            "md5(coalesce(string_agg(row::text,'' order by row::text),''))) "
            f"from ({projection(table, columns)}) original")


def current_checksums(connection, columns):
    return {t: connection.execute(digest_sql(t, columns)).fetchone()[0] for t in TABLES}


def guard(checksums, columns):
    checks = []
    for table, expected in checksums.items():
        checks.append(f"if ({digest_sql(table, columns)}) <> {literal(json.dumps(expected))}::jsonb "
                      f"then raise exception 'Application backup mismatch: {table}'; end if;")
    return 'do $preservation$ begin\n' + '\n'.join(checks) + '\nend $preservation$;\n'


def schema_guard(payload):
    source=(ROOT/'supabase/verification/necms_catalogue_readonly.sql').read_text(encoding='utf-8')
    queries=re.findall(r'(?ms)^select\b.*?;',source)
    keys=['identity','objects','columns','constraints','indexes','policies','functions','triggers','publications','ledger']
    assert len(queries)==len(keys)
    pieces=[literal(k)+",coalesce((select jsonb_agg(to_jsonb(section)) from ("+q.rstrip(';')+") section),'[]'::jsonb)"
            for k,q in zip(keys,queries) if k!='identity']
    expected={k:v for k,v in payload['catalogue'].items() if k!='identity'}
    return ("do $schema$ begin if jsonb_build_object("+','.join(pieces)+") <> "+
            literal(json.dumps(expected))+"::jsonb then raise exception 'Hosted catalogue changed since verification'; end if; end $schema$;\n")


def migration_plan(payload, check_schema=True):
    parts = []
    for entry in payload['pending']:
        path = ROOT / 'supabase/migrations' / entry['name']
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry['sha256'], 'Migration changed since backup'
        text = data.decode('utf-8')
        parts.append(re.sub(r'(?m)^(?:begin|commit);\s*$', '', text))
    locked = ','.join('public.' + table for table in TABLES)
    checks = guard(payload['checksums'], payload['columns'])
    return ("begin;set local lock_timeout='3s';set local statement_timeout='90s';"
            "set local timezone='UTC';set local datestyle='ISO, YMD';\n"
            f"lock table {locked} in access exclusive mode;\n" +
            (schema_guard(payload) if check_schema else '') + checks +
            '\n'.join(parts) + '\n' + checks +
            "select jsonb_build_object('status','preservation_checks_passed','migration_count',7) as deployment;commit;")


def local_connection(database='postgres'):
    # Explicit target and overrides are never inherited from a hosted environment.
    for name in list(os.environ):
        if name.upper().startswith('PG'):
            del os.environ[name]
    return psycopg.connect(host='127.0.0.1', port=55439, dbname=database,
                           user='necms_test_owner', password=(LOCAL/'owner-password.txt').read_text().strip(),
                           connect_timeout=5, autocommit=True, options='-c statement_timeout=90000')


def rehearse(payload):
    admin = local_connection()
    assert Path(admin.execute('show data_directory').fetchone()[0]).resolve() == (LOCAL/'data').resolve()
    assert admin.execute('show listen_addresses').fetchone()[0] == '127.0.0.1'
    assert admin.execute('show server_version').fetchone()[0].startswith('17.11')
    name = 'necms_recovery_' + str(int(time.time()))
    admin.execute(psycopg.sql.SQL('create database {}').format(psycopg.sql.Identifier(name)))
    for role in ['anon', 'authenticated']:
        if not admin.execute('select 1 from pg_roles where rolname=%s', (role,)).fetchone():
            admin.execute(psycopg.sql.SQL('create role {}').format(psycopg.sql.Identifier(role)))
    admin.close()
    db = local_connection(name)
    try:
        db.execute("set timezone='UTC';set datestyle='ISO, YMD';create schema auth;"
                   "create table auth.users(id uuid primary key,email text);"
                   "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"
                   "grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;"
                   "create publication supabase_realtime;")
        # Auth credentials are not exported. Existing profile IDs are represented
        # by empty identity stubs solely for the isolated application recovery.
        for row in payload['tables']['staff_profiles']:
            db.execute('insert into auth.users(id) values(%s)', (row['id'],))
        for migration in payload['baseline']:
            db.execute(migration['sql'])
        # This is a freshly created, explicitly verified disposable database.
        # Remove only seed resources before restoring; no hosted TRUNCATE exists.
        db.execute('truncate table public.resources cascade')
        for table in TABLES:
            if table == 'audit_events':
                # Visit INSERT audit triggers stay enabled. Replace their local
                # recovery-generated entries with the original audit snapshot.
                db.execute('truncate table public.audit_events')
            if payload['tables'][table]:
                db.execute(f'insert into public.{table} select * from jsonb_populate_recordset(null::public.{table},%s)',
                           (Jsonb(payload['tables'][table]),))
        seq = payload['sequence']
        db.execute("select setval('public.patient_reference_sequence',%s,%s)", (seq['last_value'], seq['is_called']))
        assert current_checksums(db, payload['columns']) == payload['checksums'], 'Restored data mismatch'
        # Managed owner/ACL metadata differs from the isolated Auth-stub cluster.
        # Hosted catalogue guard is independently evaluated before deployment.
        db.execute(migration_plan(payload, check_schema=False))
        assert current_checksums(db, payload['columns']) == payload['checksums'], 'Forward preservation mismatch'
        assert db.execute("select count(*) from public.hospital_memberships").fetchone()[0] == 0
        for table in ['patients','visits','resources','audit_events']:
            assert db.execute(f"select count(*) from public.{table} where hospital_id is not null or ownership_state<>'pending'").fetchone()[0] == 0
        return {'local_database': name, 'restored_application_tables': len(TABLES),
                'all_original_values_preserved': True, 'pending_migrations_rehearsed': 7,
                'ownership_unassigned': True, 'new_memberships': 0,
                'auth_scope': 'identity stubs only; no Auth credentials/platform recovery claim'}
    finally:
        db.close()


def prepare():
    state=hosted("begin read only;select to_regclass('public.hospitals') is null as original_baseline;rollback;")[0]
    if not state['original_baseline']:
        raise RuntimeError('Original six-migration baseline required; NECMS is already present. Review a new recovery plan.')
    catalogue = json.loads((ARTIFACTS/'catalogue.json').read_text())
    columns = {t: [r['column_name'] for r in catalogue['columns'] if r['schema_name']=='public' and r['table_name']==t] for t in TABLES}
    assert all(columns.values())
    fields = []
    for table in TABLES:
        fields.append(literal(table) +
                      f",coalesce((select jsonb_agg(to_jsonb(t)) from public.{table} t),'[]'::jsonb)")
    sums = ','.join(literal(t)+',('+digest_sql(t, columns)+')' for t in TABLES)
    query = ("begin read only;set local statement_timeout='20s';set local timezone='UTC';set local datestyle='ISO, YMD';"
             "select jsonb_build_object('tables',jsonb_build_object("+','.join(fields)+"),"
             "'checksums',jsonb_build_object("+sums+"),"
             "'sequence',(select jsonb_build_object('last_value',last_value,'is_called',is_called) from public.patient_reference_sequence)) as snapshot;rollback;")
    snapshot = hosted(query)[0]['snapshot']
    print('Application snapshot read into memory; record values withheld.',flush=True)
    paths = sorted((ROOT/'supabase/migrations').glob('*.sql'))
    assert len(paths) == 13
    baseline = [{'name':p.name,'sql':p.read_text(encoding='utf-8')} for p in paths[:6]]
    pending = [{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths[6:]]
    payload = {'project_ref': REF, 'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'columns':columns,'catalogue':catalogue,'baseline':baseline,'pending':pending,**snapshot}
    raw = json.dumps(payload,ensure_ascii=False).encode('utf-8')
    encrypted = protect(raw)
    assert protect(encrypted,True) == raw, 'Encrypted backup integrity failure'
    dest = ROOT/'backups'/('necms-predeployment-'+str(int(time.time()))+'.backup')
    dest.parent.mkdir(exist_ok=True);dest.write_bytes(encrypted)
    print('Per-user encrypted backup written; beginning isolated restore rehearsal.',flush=True)
    proof = rehearse(json.loads(protect(dest.read_bytes(),True)))
    hosted('begin read only;'+schema_guard(payload)+'select true as schema_guard_passed;rollback;')
    proof.update({'project_ref':REF,'backup_file':dest.name,'encrypted_sha256':hashlib.sha256(encrypted).hexdigest(),
                  'application_counts':{t:v['count'] for t,v in payload['checksums'].items()},
                  'plan_sha256':hashlib.sha256(migration_plan(payload).encode()).hexdigest()})
    (ARTIFACTS/'recovery-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps(proof))


def execute(backup):
    path=Path(backup).resolve()
    assert path.parent == (ROOT/'backups').resolve()
    proof=json.loads((ARTIFACTS/'recovery-proof.json').read_text())
    encrypted=path.read_bytes();assert hashlib.sha256(encrypted).hexdigest()==proof['encrypted_sha256']
    payload=json.loads(protect(encrypted,True));assert payload['project_ref']==REF
    sql=migration_plan(payload);assert hashlib.sha256(sql.encode()).hexdigest()==proof['plan_sha256']
    assert proof['all_original_values_preserved'] and proof['ownership_unassigned']
    # In-transaction locks and before/after digests reject stale backups and any
    # unexpected data change. On error, no migration in this batch commits.
    result=hosted(sql)
    (ARTIFACTS/'execution-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'project_ref':REF,'result':result,'hosted_migrations_executed':7}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--backup')
    args=parser.parse_args()
    try:
        if args.execute:
            assert args.backup, 'Verified encrypted backup required';execute(args.backup)
        else:prepare()
    except Exception as error:
        print(json.dumps({'status':'STOPPED','error_type':type(error).__name__,
                          'sqlstate':getattr(error,'sqlstate',None),
                          'safe_message':str(error) if type(error) is RuntimeError else None,
                          'details':'Diagnostics withheld to protect record values; no automatic retries.'}))
        sys.exit(1)
