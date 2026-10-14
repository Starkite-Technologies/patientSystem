-- Test-only fixtures for the original schema. Used by check-database.mjs.
insert into auth.users(id,email) values ('90000000-0000-0000-0000-000000000001','migration-test@example.invalid');
insert into public.staff_profiles(id,display_name,role) values ('90000000-0000-0000-0000-000000000001','Migration Coordinator','coordinator');
insert into public.visits(id,patient_ref,patient_name,age,priority,status,next_action,complaint,updated_at) values
 ('91000000-0000-0000-0000-000000000001','MIGRATION-01','Mary Jane van der Berg',35,3,'discharged','none','Test','2026-10-13T08:00:00Z'),
 ('91000000-0000-0000-0000-000000000002','migration-01','Mary Jane van der Berg',35,3,'waiting','assessment','Test','2026-10-14T08:00:00Z'),
 ('91000000-0000-0000-0000-000000000003','MIGRATION-02','Cher',40,3,'waiting','assessment','Test','2026-10-14T08:00:00Z');
