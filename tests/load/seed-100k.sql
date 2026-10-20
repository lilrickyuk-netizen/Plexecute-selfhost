-- Step 86: 100,000-account dataset. Run ONLY on an isolated restored copy (staging), never the live database.
-- Creates auth users (password LoadTest!2026), profiles via the signup trigger, 3 goals each and 1 week of plan blocks.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'load'||g||'@loadtest.invalid', crypt('LoadTest!2026', gen_salt('bf', 4)), now(), jsonb_build_object('date_of_birth','1990-01-01'), now(), now()
from generate_series(1,100000) g;
update public.profiles p set onboarded = true, timezone = 'Europe/London' from auth.users u where u.id = p.id and u.email like '%@loadtest.invalid';
insert into public.goals (user_id, title, domain, weekly_minutes, session_minutes, status, priority)
select u.id, d.t, d.d, 120, 30, 'active', 1 from auth.users u
cross join (values ('Get stronger','training'),('Learn Spanish','learning'),('Wind down','wellness')) d(t,d)
where u.email like '%@loadtest.invalid';
insert into public.plan_blocks (user_id, title, domain, starts_at, duration_min, status, source_type, occurrence_kind)
select u.id, 'Load session', 'training', date_trunc('day', now()) + (k||' days')::interval + interval '18 hours', 30, 'planned', 'goal', 'workout'
from auth.users u cross join generate_series(0,6) k where u.email like '%@loadtest.invalid';
