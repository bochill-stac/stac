create table if not exists public.videos (
  video_id text primary key,
  streamer_id text not null,
  streamer_name text not null,
  status text not null check (status in ('live','upcoming','video','archive','canceled')),
  title text not null default '',
  description text not null default '',
  published_at timestamptz,
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  duration text not null default '',
  thumbnail text not null default '',
  url text not null,
  source text not null default 'youtube',
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists videos_status_idx on public.videos(status);
create index if not exists videos_scheduled_idx on public.videos(scheduled_start_at);
create index if not exists videos_published_idx on public.videos(published_at desc);
alter table public.videos enable row level security;
drop policy if exists "public can read videos" on public.videos;
create policy "public can read videos" on public.videos for select to anon, authenticated using (true);
create or replace view public.stac_home as select * from public.videos where status <> 'canceled';
grant select on public.stac_home to anon, authenticated;
