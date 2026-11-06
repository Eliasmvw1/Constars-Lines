-- UPDATE 1: Mindest-/Maximallänge pro Line.
-- In Supabase > SQL Editor einfügen und Run drücken. Daten bleiben erhalten.

-- Optionale Mindest-/Maximallänge pro Line (Sekunden)
alter table public.lines add column if not exists min_sec real;
alter table public.lines add column if not exists max_sec real;

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

notify pgrst, 'reload schema';
