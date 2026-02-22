-- =============================================
-- YouTube Intent Mode — Supabase Schema
-- =============================================

-- Profiles (auto-created on signup via trigger)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users read own profile"
  on public.profiles for select using (auth.uid() = id);

-- Subscriptions
create table public.subscriptions (
  user_id uuid references public.profiles on delete cascade primary key,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free' check (plan in ('free', 'trial', 'pro')),
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create policy "Users read own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

-- User settings (synced to extension)
create table public.user_settings (
  user_id uuid references public.profiles on delete cascade primary key,
  session_duration_minutes integer not null default 25,
  hard_cutoff boolean not null default false,
  schedules jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
create policy "Users read own settings"
  on public.user_settings for select using (auth.uid() = user_id);
create policy "Users update own settings"
  on public.user_settings for update using (auth.uid() = user_id);

-- Session stats
create table public.session_stats (
  user_id uuid references public.profiles on delete cascade primary key,
  sessions_today integer not null default 0,
  total_sessions integer not null default 0,
  total_focus_minutes integer not null default 0,
  last_session_date date,
  updated_at timestamptz not null default now()
);

alter table public.session_stats enable row level security;
create policy "Users read own stats"
  on public.session_stats for select using (auth.uid() = user_id);
create policy "Users update own stats"
  on public.session_stats for update using (auth.uid() = user_id);

-- Auto-create rows on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.subscriptions (user_id) values (new.id);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.session_stats (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
