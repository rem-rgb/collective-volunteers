-- The Collective · Sunday Team app · database
-- Run once on a fresh Supabase project. Area content is loaded separately from data/seed.json.

-- ---------- tables ----------
create table public.people (
  email text primary key check (email = lower(email)),
  name text not null default '',
  is_admin boolean not null default false,          -- overseer: sees and edits everything
  can_see_signups boolean not null default false,   -- may read volunteer contact details
  areas text[] not null default '{}',               -- area ids this person may edit
  created_at timestamptz not null default now()
);

create table public.areas (
  id text primary key,
  title text not null,
  blurb text not null default '',
  sort int not null default 0,
  access_key text not null unique default substr(md5(gen_random_uuid()::text), 1, 16),
  needs_help boolean not null default false,
  help_note text not null default '',
  content jsonb not null default '{"sections":[]}',
  updated_at timestamptz not null default now()
);

create table public.settings (
  key text primary key,
  value text not null
);
insert into public.settings values ('overseer_key', substr(md5(gen_random_uuid()::text), 1, 20));

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  contact text not null check (char_length(contact) between 3 and 120),
  areas text[] not null default '{}' check (cardinality(areas) <= 12),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'new' check (status in ('new','contacted','rostered'))
);

-- ---------- who is asking ----------
create function public.me() returns setof public.people
language sql stable security definer set search_path = public as $$
  select * from people where email = lower(auth.jwt() ->> 'email');
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where email = lower(auth.jwt() ->> 'email') and is_admin);
$$;
create function public.can_signups() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where email = lower(auth.jwt() ->> 'email') and (is_admin or can_see_signups));
$$;
create function public.can_edit(area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where email = lower(auth.jwt() ->> 'email') and (is_admin or area = any(areas)));
$$;

-- ---------- volunteer access by link (no sign-in) ----------
create function public.get_areas(ks text[]) returns json
language sql stable security definer set search_path = public as $$
  with k as (select ks[1:10] as ks),
       ov as (select exists (select 1 from settings, k where key = 'overseer_key' and value = any(k.ks)) as yes)
  select json_build_object(
    'overseer', (select yes from ov),
    'areas', coalesce((
      select json_agg(json_build_object('id', a.id, 'title', a.title, 'blurb', a.blurb, 'sort', a.sort,
                                        'needs_help', a.needs_help, 'help_note', a.help_note, 'content', a.content) order by a.sort)
      from areas a, k where (select yes from ov) or a.access_key = any(k.ks)), '[]'::json));
$$;

create function public.public_areas() returns table (id text, title text, blurb text, needs_help boolean, help_note text)
language sql stable security definer set search_path = public as $$
  select id, title, blurb, needs_help, help_note from areas order by sort;
$$;

create function public.touch_area() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger areas_touch before update on public.areas for each row execute function public.touch_area();

-- ---------- row level security ----------
alter table public.people   enable row level security;
alter table public.areas    enable row level security;
alter table public.settings enable row level security;
alter table public.signups  enable row level security;

revoke all on public.people, public.areas, public.settings, public.signups from anon, authenticated;

-- people: you can read your own row; overseers manage the list
grant select, insert, update, delete on public.people to authenticated;
create policy people_read  on public.people for select to authenticated using (public.is_admin() or email = lower(auth.jwt() ->> 'email'));
create policy people_write on public.people for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- areas: editors read and edit their own areas; only content and sign-up wording are editable
grant select on public.areas to authenticated;
grant update (content, needs_help, help_note) on public.areas to authenticated;
create policy areas_read on public.areas for select to authenticated using (public.can_edit(id));
create policy areas_edit on public.areas for update to authenticated using (public.can_edit(id)) with check (public.can_edit(id));

-- settings (overseer link): overseers only
grant select on public.settings to authenticated;
create policy settings_read on public.settings for select to authenticated using (public.is_admin());

-- sign-ups: anyone can send one; only overseers and "can see sign-ups" people can read them
grant insert (name, contact, areas, note) on public.signups to anon, authenticated;
grant select, delete on public.signups to authenticated;
grant update (status) on public.signups to authenticated;
create policy signups_add    on public.signups for insert to anon, authenticated with check (true);
create policy signups_read   on public.signups for select to authenticated using (public.can_signups());
create policy signups_status on public.signups for update to authenticated using (public.can_signups()) with check (public.can_signups());
create policy signups_delete on public.signups for delete to authenticated using (public.can_signups());

revoke execute on function public.me(), public.is_admin(), public.can_signups(), public.can_edit(text) from anon;

-- ---------- screenshots uploaded from phones ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shots', 'shots', true, 3145728, array['image/jpeg']);
-- files are stored as <area id>/<file>.jpg; only editors of that area may upload
create policy shots_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'shots' and public.can_edit((storage.foldername(name))[1]));
