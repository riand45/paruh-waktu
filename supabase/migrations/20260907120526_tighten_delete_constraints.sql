-- I8a: profiles.id -> auth.users(id) currently cascades, but ~12 other FKs
-- pointing at profiles are NO ACTION, so the cascade can never actually
-- complete in practice — deleting a user always fails with an FK
-- violation the moment they've touched anything. Make it consistent:
-- deletion fails cleanly and comprehensibly at the first FK hop. A
-- deliberate user-deletion/anonymization routine is a future concern, not
-- this phase's — the existing account_status = 'suspended' soft-delete
-- path already covers deactivation.
alter table public.profiles
  drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id);

-- I8b: jobs' own children were split between CASCADE (applications,
-- assignments, attachments, evidences) and NO ACTION (payments,
-- conversations, wallet_transactions). Job deletion should always be a
-- hard error, never a partial destructive cascade that silently destroys
-- application/assignment history while leaving payment records orphaned
-- error cases elsewhere. Align all of jobs' children to NO ACTION.
alter table public.job_applications
  drop constraint job_applications_job_id_fkey,
  add constraint job_applications_job_id_fkey
    foreign key (job_id) references public.jobs (id);

alter table public.job_assignments
  drop constraint job_assignments_job_id_fkey,
  add constraint job_assignments_job_id_fkey
    foreign key (job_id) references public.jobs (id);

alter table public.job_attachments
  drop constraint job_attachments_job_id_fkey,
  add constraint job_attachments_job_id_fkey
    foreign key (job_id) references public.jobs (id);

alter table public.job_evidences
  drop constraint job_evidences_job_id_fkey,
  add constraint job_evidences_job_id_fkey
    foreign key (job_id) references public.jobs (id);
