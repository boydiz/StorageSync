-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create app_role enum
create type app_role as enum ('admin', 'viewer');

-- BINS table
create table bins (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  bin_number int not null,
  name text not null,
  location text not null default '',
  description text not null default '',
  color text not null default '#3b82f6',
  created_at timestamptz default now() not null,
  unique(user_id, bin_number)
);

-- ITEMS table
create table items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  bin_id uuid references bins(id) on delete cascade not null,
  name text not null,
  quantity int not null default 1,
  description text not null default '',
  created_at timestamptz default now() not null
);

-- APP_SETTINGS table
create table app_settings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  app_name text not null default 'StorageSync',
  app_description text not null default '',
  logo_data_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- USER_ROLES table
create table user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique(user_id, role)
);

-- SHARED_ACCESS table
create table shared_access (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references auth.users(id) on delete cascade not null,
  shared_with_user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(owner_id, shared_with_user_id)
);

-- FUNCTIONS

-- Get user ID by email
create or replace function get_user_id_by_email(_email text)
returns uuid
language plpgsql
security definer
as $$
declare
  _user_id uuid;
begin
  select id into _user_id from auth.users where email = _email;
  return _user_id;
end;
$$;

-- Check if user has role
create or replace function has_role(_user_id uuid, _role app_role)
returns boolean
language plpgsql
security definer
as $$
begin
  return exists (
    select 1 from user_roles
    where user_id = _user_id and role = _role
  );
end;
$$;

-- Check shared access
create or replace function has_shared_access(_owner_id uuid, _user_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return exists (
    select 1 from shared_access
    where owner_id = _owner_id and shared_with_user_id = _user_id
  );
end;
$$;

-- Get next bin number for user
create or replace function get_next_bin_number(_user_id uuid)
returns int
language plpgsql
security definer
as $$
declare
  _next_num int;
begin
  select coalesce(max(bin_number), 0) + 1 into _next_num
  from bins where user_id = _user_id;
  return _next_num;
end;
$$;

-- RLS POLICIES

alter table bins enable row level security;
alter table items enable row level security;
alter table app_settings enable row level security;
alter table user_roles enable row level security;
alter table shared_access enable row level security;

-- BINS policies
create policy "Users can manage own bins" on bins
  for all using (auth.uid() = user_id);

create policy "Viewers can read shared bins" on bins
  for select using (
    has_shared_access(user_id, auth.uid())
  );

-- ITEMS policies
create policy "Users can manage own items" on items
  for all using (auth.uid() = user_id);

create policy "Viewers can read shared items" on items
  for select using (
    has_shared_access(user_id, auth.uid())
  );

-- APP_SETTINGS policies
create policy "Users can manage own settings" on app_settings
  for all using (auth.uid() = user_id);

create policy "Viewers can read owner settings" on app_settings
  for select using (
    has_shared_access(user_id, auth.uid())
  );

-- USER_ROLES policies
create policy "Users can read own roles" on user_roles
  for select using (auth.uid() = user_id);

create policy "Admins can manage roles" on user_roles
  for all using (auth.uid() = user_id);

-- SHARED_ACCESS policies
create policy "Owners can manage shared access" on shared_access
  for all using (auth.uid() = owner_id);

create policy "Viewers can read their access" on shared_access
  for select using (auth.uid() = shared_with_user_id);

-- TRIGGER: auto-create settings on signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into app_settings (user_id, app_name, app_description)
  values (new.id, 'StorageSync', '');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
