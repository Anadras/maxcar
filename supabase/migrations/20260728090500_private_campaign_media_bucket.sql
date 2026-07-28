-- MAX-002: reserve a private bucket for pre-synchronized campaign media.
-- No storage.objects policies are added yet: only service-side operations can
-- write until the authenticated upload and device credential flows are designed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-media',
  'campaign-media',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
