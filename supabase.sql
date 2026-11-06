-- =====================================================================
--  LINE STUDIO – Datenbank-Setup für Supabase
--  Einmal komplett in Supabase > SQL Editor einfügen und "Run" drücken.
--  Kann gefahrlos mehrmals ausgeführt werden.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabellen ----------------------------------------------------

create table if not exists public.settings (
  key   text primary key,
  value text not null
);

create table if not exists public.speakers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  password_hash text not null,
  sort          int  not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.lines (
  id         uuid primary key default gen_random_uuid(),
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  text       text not null,
  note       text not null default '',
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.takes (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references public.lines(id) on delete cascade,
  path       text not null unique,
  duration   real,
  is_best    boolean not null default false,
  status     text not null default 'pending',   -- pending | ready
  created_at timestamptz not null default now()
);

-- Pfade gelöschter Takes: nur diese Dateien dürfen aus dem Storage entfernt werden
create table if not exists public.trash (
  path       text primary key,
  created_at timestamptz not null default now()
);

-- Optionale Mindest-/Maximallänge pro Line (Sekunden)
alter table public.lines add column if not exists min_sec real;
alter table public.lines add column if not exists max_sec real;

create index if not exists lines_speaker_idx on public.lines(speaker_id);
create index if not exists takes_line_idx    on public.takes(line_id);

-- Niemand darf direkt an die Tabellen. Alles läuft über die Funktionen unten,
-- die das Passwort prüfen.
alter table public.settings enable row level security;
alter table public.speakers enable row level security;
alter table public.lines    enable row level security;
alter table public.takes    enable row level security;
alter table public.trash    enable row level security;
revoke all on public.settings, public.speakers, public.lines, public.takes, public.trash
  from anon, authenticated;

create or replace function public._trash_take() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trash(path) values (old.path) on conflict do nothing;
  return old;
end $$;

drop trigger if exists takes_to_trash on public.takes;
create trigger takes_to_trash before delete on public.takes
  for each row execute function public._trash_take();

-- ---------- Storage (Audio-Dateien) ------------------------------------
-- Öffentlicher Bucket, aber jede Datei hat einen zufälligen, nicht erratbaren
-- Pfad, und Auflisten ist verboten. Die Pfade bekommt man nur mit Passwort.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('takes', 'takes', true, 52428800, array['audio/wav'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['audio/wav'];

create or replace function public.can_upload(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.takes
    where path = object_name and status = 'pending'
      and created_at > now() - interval '2 hours'
  );
$$;

create or replace function public.can_delete(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trash where path = object_name);
$$;

drop policy if exists "line studio upload" on storage.objects;
create policy "line studio upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'takes' and public.can_upload(name));

drop policy if exists "line studio select trash" on storage.objects;
create policy "line studio select trash" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'takes' and public.can_delete(name));

drop policy if exists "line studio delete" on storage.objects;
create policy "line studio delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'takes' and public.can_delete(name));

-- ---------- Hilfsfunktionen --------------------------------------------

create or replace function public._check_admin(pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  select value into h from public.settings where key = 'admin_password_hash';
  if h is null or pw is null or crypt(pw, h) <> h then
    raise exception 'Falsches Admin-Passwort' using errcode = '28P01';
  end if;
end $$;

create or replace function public._check_speaker(sid uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  select password_hash into h from public.speakers where id = sid;
  if h is null or pw is null or crypt(pw, h) <> h then
    raise exception 'Falsches Passwort' using errcode = '28P01';
  end if;
end $$;

create or replace function public._lines_json(sid uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', l.id, 'text', l.text, 'note', l.note, 'sort', l.sort,
           'min_sec', l.min_sec, 'max_sec', l.max_sec,
           'takes', (
             select coalesce(json_agg(json_build_object(
                      'id', t.id, 'path', t.path, 'duration', t.duration,
                      'is_best', t.is_best, 'created_at', t.created_at)
                    order by t.created_at), '[]'::json)
             from public.takes t where t.line_id = l.id and t.status = 'ready')
         ) order by l.sort, l.created_at), '[]'::json)
  from public.lines l where l.speaker_id = sid;
$$;

-- ---------- Funktionen für die Sprecher --------------------------------

create or replace function public.list_speakers()
returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name from public.speakers s order by s.sort, s.name;
$$;

create or replace function public.speaker_data(sid uuid, pw text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_speaker(sid, pw);
  return json_build_object(
    'id', sid,
    'name', (select name from public.speakers where id = sid),
    'lines', public._lines_json(sid));
end $$;

create or replace function public.start_take(sid uuid, pw text, lid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare tid uuid := gen_random_uuid(); p text;
begin
  perform public._check_speaker(sid, pw);
  if not exists (select 1 from public.lines where id = lid and speaker_id = sid) then
    raise exception 'Line nicht gefunden';
  end if;
  p := sid::text || '/' || lid::text || '/' || tid::text || '.wav';
  insert into public.takes(id, line_id, path) values (tid, lid, p);
  return json_build_object('id', tid, 'path', p);
end $$;

create or replace function public.finish_take(sid uuid, pw text, tid uuid, dur real) returns json
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  perform public._check_speaker(sid, pw);
  select t.line_id into lid from public.takes t join public.lines l on l.id = t.line_id
   where t.id = tid and l.speaker_id = sid;
  if lid is null then raise exception 'Take nicht gefunden'; end if;
  update public.takes set status = 'ready', duration = dur,
         is_best = not exists (select 1 from public.takes
                               where line_id = lid and status = 'ready' and is_best)
   where id = tid and status = 'pending';
  return public.speaker_data(sid, pw);
end $$;

create or replace function public._set_best(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select line_id into lid from public.takes where id = tid;
  update public.takes set is_best = (id = tid) where line_id = lid;
end $$;

create or replace function public._delete_take(tid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare lid uuid; p text; was_best boolean;
begin
  delete from public.takes where id = tid returning line_id, path, is_best into lid, p, was_best;
  if was_best then
    update public.takes set is_best = true
     where id = (select id from public.takes where line_id = lid and status = 'ready'
                 order by created_at desc limit 1);
  end if;
  return p;
end $$;

create or replace function public.set_best(sid uuid, pw text, tid uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_speaker(sid, pw);
  if not exists (select 1 from public.takes t join public.lines l on l.id = t.line_id
                 where t.id = tid and l.speaker_id = sid) then
    raise exception 'Take nicht gefunden';
  end if;
  perform public._set_best(tid);
  return public.speaker_data(sid, pw);
end $$;

create or replace function public.delete_take(sid uuid, pw text, tid uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_speaker(sid, pw);
  if not exists (select 1 from public.takes t join public.lines l on l.id = t.line_id
                 where t.id = tid and l.speaker_id = sid) then
    raise exception 'Take nicht gefunden';
  end if;
  return public._delete_take(tid);
end $$;

-- ---------- Funktionen für dich (Admin) --------------------------------

create or replace function public.admin_is_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.settings where key = 'admin_password_hash');
$$;

-- Funktioniert nur ein einziges Mal: beim allerersten Öffnen der Admin-Seite.
create or replace function public.admin_setup(new_pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(new_pw, '')) < 4 then raise exception 'Passwort zu kurz'; end if;
  insert into public.settings(key, value)
  values ('admin_password_hash', crypt(new_pw, gen_salt('bf')))
  on conflict (key) do nothing;
  if not found then raise exception 'Admin-Passwort ist schon gesetzt'; end if;
end $$;

create or replace function public.admin_change_password(pw text, new_pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._check_admin(pw);
  if length(coalesce(new_pw, '')) < 4 then raise exception 'Passwort zu kurz'; end if;
  update public.settings set value = crypt(new_pw, gen_salt('bf'))
   where key = 'admin_password_hash';
end $$;

create or replace function public.admin_data(pw text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(pw);
  return (select coalesce(json_agg(json_build_object(
            'id', s.id, 'name', s.name, 'lines', public._lines_json(s.id))
          order by s.sort, s.name), '[]'::json) from public.speakers s);
end $$;

create or replace function public.admin_save_speaker(pw text, sid uuid, new_name text, new_pw text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare rid uuid;
begin
  perform public._check_admin(pw);
  if length(trim(coalesce(new_name, ''))) = 0 then raise exception 'Name fehlt'; end if;
  if sid is null then
    if length(coalesce(new_pw, '')) = 0 then raise exception 'Passwort fehlt'; end if;
    insert into public.speakers(name, password_hash, sort)
    values (trim(new_name), crypt(new_pw, gen_salt('bf')),
            coalesce((select max(sort) + 1 from public.speakers), 0))
    returning id into rid;
  else
    update public.speakers set name = trim(new_name),
           password_hash = case when length(coalesce(new_pw, '')) > 0
                                then crypt(new_pw, gen_salt('bf')) else password_hash end
     where id = sid returning id into rid;
  end if;
  return rid;
end $$;

create or replace function public.admin_delete_speaker(pw text, sid uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._check_admin(pw);
  select coalesce(array_agg(t.path), '{}') into paths
    from public.takes t join public.lines l on l.id = t.line_id where l.speaker_id = sid;
  delete from public.speakers where id = sid;
  return paths;
end $$;

create or replace function public.admin_add_lines(pw text, sid uuid, texts text[]) returns void
language plpgsql security definer set search_path = public as $$
declare s int; t text;
begin
  perform public._check_admin(pw);
  select coalesce(max(sort) + 1, 0) into s from public.lines where speaker_id = sid;
  foreach t in array texts loop
    if length(trim(t)) > 0 then
      insert into public.lines(speaker_id, text, sort) values (sid, trim(t), s);
      s := s + 1;
    end if;
  end loop;
end $$;

create or replace function public.admin_update_line(pw text, lid uuid, new_text text, new_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(pw);
  update public.lines set text = coalesce(new_text, text), note = coalesce(new_note, note)
   where id = lid;
end $$;

create or replace function public.admin_set_line_limits(pw text, lid uuid, new_min real, new_max real)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(pw);
  if new_min is not null and new_min <= 0 then new_min := null; end if;
  if new_max is not null and new_max <= 0 then new_max := null; end if;
  if new_min is not null and new_max is not null and new_min > new_max then
    raise exception 'Mindestlänge ist größer als Maximallänge';
  end if;
  update public.lines set min_sec = new_min, max_sec = new_max where id = lid;
end $$;

create or replace function public.admin_move_line(pw text, lid uuid, dir int) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid; ids uuid[]; i int; j int;
begin
  perform public._check_admin(pw);
  select speaker_id into sid from public.lines where id = lid;
  select array_agg(id order by sort, created_at) into ids from public.lines where speaker_id = sid;
  i := array_position(ids, lid);
  j := i + sign(dir)::int;
  if i is null or j < 1 or j > array_length(ids, 1) then return; end if;
  ids[i] := ids[j]; ids[j] := lid;
  update public.lines l set sort = x.ord - 1
    from unnest(ids) with ordinality as x(id, ord) where l.id = x.id;
end $$;

create or replace function public.admin_delete_line(pw text, lid uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._check_admin(pw);
  select coalesce(array_agg(path), '{}') into paths from public.takes where line_id = lid;
  delete from public.lines where id = lid;
  return paths;
end $$;

create or replace function public.admin_set_best(pw text, tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(pw);
  perform public._set_best(tid);
end $$;

create or replace function public.admin_delete_take(pw text, tid uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(pw);
  return public._delete_take(tid);
end $$;

-- Interne Hilfsfunktionen nicht von außen aufrufbar machen
revoke execute on function public._check_admin(text), public._check_speaker(uuid, text),
  public._lines_json(uuid), public._set_best(uuid), public._delete_take(uuid),
  public._trash_take() from public, anon, authenticated;

notify pgrst, 'reload schema';
