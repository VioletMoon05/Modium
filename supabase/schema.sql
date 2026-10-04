-- Modium shared backend schema for Supabase.
-- Run once in Supabase Dashboard -> SQL Editor. This is designed for anon-key use with RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_-]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar text not null default '' check (char_length(avatar) <= 300000 and (avatar = '' or avatar ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 3 and 40),
  type text not null check (type in ('mods','modpacks','resourcepacks','plugins','shaders','structures')),
  visibility text not null check (visibility in ('public','unlisted','private')),
  resolution text check (resolution is null or resolution in ('8x','16x','32x','48x','64x','128x','256x','512x')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  categories text[] not null default '{}',
  icon text not null default '' check (char_length(icon) <= 200000 and (icon = '' or icon ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  banner text not null default '' check (char_length(banner) <= 470000 and (banner = '' or banner ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  summary text not null check (char_length(summary) between 1 and 200),
  download_mode text not null check (download_mode in ('url','upload')),
  download_url text,
  file_path text unique,
  file_name text,
  file_size bigint,
  downloads bigint not null default 0 check (downloads >= 0),
  follows bigint not null default 0 check (follows >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_resolution_type check (type = 'resourcepacks' or resolution is null),
  constraint projects_resolution_required check (type <> 'resourcepacks' or resolution is not null),
  constraint projects_download_fields check (
    (download_mode = 'url' and download_url is not null and download_url ~ '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
      and split_part(split_part(download_url, '://', 2), '/', 1) !~ '@'
      and char_length(download_url) <= 2048 and file_path is null and file_name is null and file_size is null)
    or
    (download_mode = 'upload' and download_url is null and file_path is not null and file_path ~ ('^' || owner_id::text || '/[0-9a-fA-F-]{36}/[^/]{1,120}$') and file_name is not null and char_length(file_name) between 1 and 120 and file_size is not null and file_size between 1 and 26214400)
  ),
  constraint projects_categories_limit check (cardinality(categories) <= 8)
);

create table if not exists public.project_collaborators (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists projects_public_type_created on public.projects(type, created_at desc) where visibility = 'public';
create index if not exists projects_owner_created on public.projects(owner_id, created_at desc);
create index if not exists project_collaborators_user on public.project_collaborators(user_id, project_id);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  requested_display text := coalesce(new.raw_user_meta_data ->> 'display_name', '');
begin
  if requested_username !~ '^[a-z0-9_-]{3,20}$' then
    raise exception 'Invalid Modium username';
  end if;
  if char_length(requested_display) < 1 or char_length(requested_display) > 40 or requested_display ~ '[[:cntrl:]<>]' then
    raise exception 'Invalid Modium display name';
  end if;
  insert into public.profiles(id, username, display_name)
  values (new.id, requested_username, requested_display);
  return new;
end;
$$;

drop trigger if exists modium_create_profile on auth.users;
create trigger modium_create_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

create or replace function public.touch_project_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists modium_touch_project on public.projects;
create trigger modium_touch_project before update on public.projects
  for each row execute function public.touch_project_updated_at();

-- Users who opt into MFA must complete the second factor before private access or writes.
-- SECURITY DEFINER is required because authenticated users cannot query auth.mfa_factors directly.
create or replace function public.mfa_assurance_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when (select auth.jwt() ->> 'aal') = 'aal2' then true
    else not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  end;
$$;

create or replace function public.can_view_project(target_id uuid, allow_unlisted boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = target_id
      and (
        p.visibility = 'public'
        or (allow_unlisted and p.visibility = 'unlisted')
        or (p.owner_id = (select auth.uid()) and public.mfa_assurance_satisfied())
        or exists (
          select 1 from public.project_collaborators c
          where c.project_id = p.id and c.user_id = (select auth.uid())
            and public.mfa_assurance_satisfied()
        )
      )
  );
$$;

create or replace function public.can_create_project()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_id uuid := (select auth.uid());
  owned_count integer;
begin
  if current_id is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_id::text, 571));
  select count(*) into owned_count from public.projects p where p.owner_id = current_id;
  return owned_count < 100;
end;
$$;

create or replace function public.can_add_project_collaborator(target_project uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_owner uuid;
  collaborator_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_project::text, 109));
  select p.owner_id into current_owner from public.projects p where p.id = target_project;
  if current_owner is null or current_owner <> (select auth.uid()) then
    return false;
  end if;
  select count(*) into collaborator_count from public.project_collaborators c where c.project_id = target_project;
  return collaborator_count < 10;
end;
$$;

create or replace function public.enforce_project_collaborator_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  collaborator_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 109));
  select p.owner_id into owner_id from public.projects p where p.id = new.project_id;
  if owner_id is null or owner_id <> (select auth.uid()) then
    raise exception 'Only the project owner may add collaborators';
  end if;
  select count(*) into collaborator_count from public.project_collaborators c where c.project_id = new.project_id;
  if collaborator_count >= 10 then
    raise exception 'A project may have at most 10 collaborators';
  end if;
  return new;
end;
$$;

drop trigger if exists modium_limit_project_collaborators on public.project_collaborators;
create trigger modium_limit_project_collaborators
  before insert on public.project_collaborators
  for each row execute function public.enforce_project_collaborator_limit();

create or replace function public.can_upload_project_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.file_path = object_name
      and p.download_mode = 'upload'
      and p.owner_id = (select auth.uid())
      and split_part(object_name, '/', 1) = (select auth.uid())::text
  );
$$;

create or replace function public.can_read_project_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.file_path = object_name and public.can_view_project(p.id, true)
  );
$$;

create or replace function public.get_project_by_slug(project_slug text)
returns setof public.projects
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.projects p
  where p.slug = lower(project_slug)
    and public.can_view_project(p.id, true)
  limit 1;
$$;

create or replace function public.increment_project_downloads(project_slug text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.projects p set downloads = least(p.downloads + 1, 1000000000)
  where p.slug = lower(project_slug) and public.can_view_project(p.id, true);
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare current_id uuid := (select auth.uid());
begin
  if current_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.mfa_assurance_satisfied() then
    raise exception 'Complete multi-factor authentication before deleting the account';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files'
      and (storage.foldername(o.name))[1] = current_id::text
  ) then
    raise exception 'Remove the account project files through Storage before deleting the account';
  end if;
  -- Do not delete rows from storage.objects directly; that can orphan the actual objects.
  delete from auth.users u where u.id = current_id;
  return true;
end;
$$;

create or replace function public.project_upload_within_quota(object_name text, object_metadata jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  owner_folder text := (storage.foldername(object_name))[1];
  incoming_size bigint;
  current_usage bigint;
begin
  if owner_folder is null or owner_folder !~* '^[0-9a-f-]{36}$'
     or (select auth.uid()) is null
     or owner_folder <> (select auth.uid())::text
     or object_metadata ->> 'size' is null or object_metadata ->> 'size' !~ '^[0-9]+$' then
    return false;
  end if;
  incoming_size := (object_metadata ->> 'size')::bigint;
  if incoming_size < 1 or incoming_size > 26214400 then
    return false;
  end if;

  -- Serialize per-owner uploads so simultaneous requests cannot race past the quota.
  perform pg_advisory_xact_lock(hashtextextended(owner_folder, 0));
  select coalesce(sum(case when o.metadata ->> 'size' ~ '^[0-9]+$'
    then (o.metadata ->> 'size')::bigint else 0 end), 0)
    into current_usage
    from storage.objects o
    where o.bucket_id = 'project-files'
      and (storage.foldername(o.name))[1] = owner_folder;
  if current_usage + incoming_size > 104857600 then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.touch_project_updated_at() from public, anon, authenticated;
revoke all on function public.mfa_assurance_satisfied() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.project_upload_within_quota(text, jsonb) from public, anon, authenticated;
revoke all on function public.can_create_project() from public, anon;
revoke all on function public.can_add_project_collaborator(uuid) from public, anon;
revoke all on function public.enforce_project_collaborator_limit() from public, anon, authenticated;
revoke all on function public.can_upload_project_file(text) from public, anon;
grant execute on function public.can_view_project(uuid, boolean) to anon, authenticated;
grant execute on function public.mfa_assurance_satisfied() to authenticated;
grant execute on function public.can_create_project() to authenticated;
grant execute on function public.can_add_project_collaborator(uuid) to authenticated;
grant execute on function public.can_upload_project_file(text) to authenticated;
grant execute on function public.project_upload_within_quota(text, jsonb) to authenticated;
grant execute on function public.can_read_project_file(text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_collaborators enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  as permissive for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and public.mfa_assurance_satisfied());
drop policy if exists "Verified MFA required for profile updates" on public.profiles;
create policy "Verified MFA required for profile updates" on public.profiles
  as restrictive for update to authenticated
  using (public.mfa_assurance_satisfied()) with check (public.mfa_assurance_satisfied());

drop policy if exists "Public and authorized projects are readable" on public.projects;
create policy "Public and authorized projects are readable" on public.projects
  for select to anon, authenticated using (public.can_view_project(id, false));

drop policy if exists "Users create their own projects" on public.projects;
create policy "Users create their own projects" on public.projects
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and public.mfa_assurance_satisfied()
    and public.can_create_project()
    and (type <> 'resourcepacks' or resolution is not null)
  );
drop policy if exists "Verified MFA required to create projects" on public.projects;
create policy "Verified MFA required to create projects" on public.projects
  as restrictive for insert to authenticated with check (public.mfa_assurance_satisfied());

drop policy if exists "Owners update their projects" on public.projects;

drop policy if exists "Owners delete their projects" on public.projects;
create policy "Owners delete their projects" on public.projects
  for delete to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Verified MFA required to delete projects" on public.projects;
create policy "Verified MFA required to delete projects" on public.projects
  as restrictive for delete to authenticated using (public.mfa_assurance_satisfied());

drop policy if exists "Visible project collaborators are readable" on public.project_collaborators;
create policy "Visible project collaborators are readable" on public.project_collaborators
  for select to anon, authenticated using (public.can_view_project(project_id, false));

drop policy if exists "Owners add collaborators" on public.project_collaborators;
create policy "Owners add collaborators" on public.project_collaborators
  for insert to authenticated with check (
    user_id <> (select auth.uid())
    and public.can_add_project_collaborator(project_id)
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
drop policy if exists "Verified MFA required to add collaborators" on public.project_collaborators;
create policy "Verified MFA required to add collaborators" on public.project_collaborators
  as restrictive for insert to authenticated with check (public.mfa_assurance_satisfied());

drop policy if exists "Owners remove collaborators" on public.project_collaborators;
create policy "Owners remove collaborators" on public.project_collaborators
  for delete to authenticated using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
drop policy if exists "Verified MFA required to remove collaborators" on public.project_collaborators;
create policy "Verified MFA required to remove collaborators" on public.project_collaborators
  as restrictive for delete to authenticated using (public.mfa_assurance_satisfied());

grant select on public.profiles to anon, authenticated;
grant update (display_name, bio, avatar) on public.profiles to authenticated;
revoke update on public.projects from anon, authenticated;
grant select, insert, delete on public.projects to authenticated;
grant select on public.projects to anon;
grant select, insert, delete on public.project_collaborators to authenticated;
grant select on public.project_collaborators to anon;
grant execute on function public.get_project_by_slug(text) to anon, authenticated;
grant execute on function public.increment_project_downloads(text) to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "Project files may be downloaded when project is visible" on storage.objects;
create policy "Project files may be downloaded when project is visible" on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'project-files'
    and (
      public.can_read_project_file(name)
      or (
        (storage.foldername(name))[1] = (select auth.uid())::text
        and public.mfa_assurance_satisfied()
      )
    )
  );

drop policy if exists "Owners upload project files" on storage.objects;
create policy "Owners upload project files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'project-files'
    and public.can_upload_project_file(name)
    and public.project_upload_within_quota(name, metadata)
  );
drop policy if exists "Verified MFA required to upload project files" on storage.objects;
create policy "Verified MFA required to upload project files" on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id <> 'project-files' or public.mfa_assurance_satisfied()
  );

drop policy if exists "Owners delete project files" on storage.objects;
create policy "Owners delete project files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Verified MFA required to delete project files" on storage.objects;
create policy "Verified MFA required to delete project files" on storage.objects
  as restrictive for delete to authenticated using (
    bucket_id <> 'project-files' or public.mfa_assurance_satisfied()
  );


-- Configure Auth -> URL Configuration in the dashboard:
-- Site URL: your Cloudflare Pages URL; add it and localhost to the Redirect URLs list.
-- Enable email confirmation and set a production SMTP provider before public launch.
-- The bucket caps individual objects at 25 MiB; an RLS helper enforces 100 MiB per owner.
