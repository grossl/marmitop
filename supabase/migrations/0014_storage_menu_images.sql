-- 0014_storage_menu_images.sql
--
-- Bucket `menu-images` and its storage.objects policies (05.data-model.md
-- "Storage buckets", ADR-017). Object path:
-- {restaurant_id}/menu/{menu_item_id}/{uuid}.{ext}. Reads are public by URL.
-- Writes come from the browser under the user's session and pass only for an
-- admin of the restaurant named by the first path segment.
--
-- Skipped when the storage schema does not exist (the integration-test
-- database).

do $do$
begin
  if not exists (
    select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage schema not found: skipping bucket menu-images (expected on the integration-test database)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-images', 'menu-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- CASE fixes the evaluation order: the uuid cast only runs on a
  -- uuid-shaped first segment, so a malformed path is refused, not an error.
  execute $p$drop policy if exists menu_images_admin_insert on storage.objects$p$;
  execute $p$drop policy if exists menu_images_admin_update on storage.objects$p$;
  execute $p$drop policy if exists menu_images_admin_delete on storage.objects$p$;

  execute $p$
    create policy menu_images_admin_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'menu-images'
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then mt.is_admin(((storage.foldername(name))[1])::uuid)
               else false end
    )
  $p$;
  execute $p$
    create policy menu_images_admin_update on storage.objects for update to authenticated
    using (
      bucket_id = 'menu-images'
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then mt.is_admin(((storage.foldername(name))[1])::uuid)
               else false end
    )
    with check (
      bucket_id = 'menu-images'
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then mt.is_admin(((storage.foldername(name))[1])::uuid)
               else false end
    )
  $p$;
  execute $p$
    create policy menu_images_admin_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'menu-images'
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then mt.is_admin(((storage.foldername(name))[1])::uuid)
               else false end
    )
  $p$;
exception
  when insufficient_privilege then
    raise warning 'could not configure storage for menu-images (%): create the bucket and policies by hand', sqlerrm;
end
$do$;
