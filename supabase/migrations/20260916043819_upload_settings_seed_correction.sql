-- Upload settings enforcement (spec docs/superpowers/specs/2026-09-16-upload-settings-enforcement-design.md
-- §6): correct the Phase 1 seed values before any code reads them for real
-- enforcement. The original seed (5MB, no PDF) would immediately regress
-- real upload flows that already work today: job completion evidence
-- allows up to 20MB video, and KTP/payment-proof/withdrawal-proof/
-- refund-proof all allow PDF. 20MB plus the union of every upload type's
-- own allowed mime types preserves today's actual behavior unchanged; an
-- admin can still tighten either value afterward via /admin/settings.
--
-- Plain `update` statements, not the update_platform_setting RPC -- that
-- RPC's is_admin() check requires auth.uid(), unavailable in a migration.

update public.platform_settings
set value = '20'
where key = 'max_upload_size_mb';

update public.platform_settings
set value = '["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"]'
where key = 'allowed_file_types';
