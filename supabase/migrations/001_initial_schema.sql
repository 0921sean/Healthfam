-- healthfam 초기 스키마
-- Supabase SQL Editor에서 실행하세요.

-- 프로필
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text not null,
  push_token text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "프로필 본인 읽기" on profiles
  for select using (auth.uid() = id);

create policy "프로필 본인 수정" on profiles
  for all using (auth.uid() = id);

-- 같은 그룹 멤버는 서로 프로필 읽기 가능
create policy "같은 그룹 멤버 프로필 읽기" on profiles
  for select using (
    exists (
      select 1 from members m1
      join members m2 on m1.group_id = m2.group_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.id
    )
  );

-- 모임
create table if not exists groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  weekly_target int not null check (weekly_target between 1 and 7),
  penalty_per_miss int not null check (penalty_per_miss >= 0),
  mode text not null check (mode in ('savage', 'awkward')),
  created_by uuid references auth.users not null,
  invite_code text unique not null,
  created_at timestamptz default now()
);

alter table groups enable row level security;

create policy "그룹 멤버 읽기" on groups
  for select using (
    exists (
      select 1 from members
      where members.group_id = groups.id
        and members.user_id = auth.uid()
    )
  );

create policy "그룹 생성" on groups
  for insert with check (auth.uid() = created_by);

create policy "방장 수정" on groups
  for update using (auth.uid() = created_by);

-- 초대 코드로 그룹 조회 (비인증 포함)
create policy "초대 코드로 조회" on groups
  for select using (true);

-- 멤버
create table if not exists members (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  role text not null check (role in ('admin', 'member')),
  display_name text not null,
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

alter table members enable row level security;

create policy "같은 그룹 멤버 읽기" on members
  for select using (
    exists (
      select 1 from members m
      where m.group_id = members.group_id
        and m.user_id = auth.uid()
    )
  );

create policy "멤버 참여" on members
  for insert with check (auth.uid() = user_id);

create policy "멤버 삭제 (본인 or 방장)" on members
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from groups
      where groups.id = members.group_id
        and groups.created_by = auth.uid()
    )
  );

-- 체크인
create table if not exists checkins (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  photo_url text not null,
  checked_at timestamptz default now(),
  week_number int not null,
  year int not null,
  flagged boolean default false
);

alter table checkins enable row level security;

create policy "같은 그룹 체크인 읽기" on checkins
  for select using (
    exists (
      select 1 from members
      where members.group_id = checkins.group_id
        and members.user_id = auth.uid()
    )
  );

create policy "본인 체크인 등록" on checkins
  for insert with check (auth.uid() = user_id);

create policy "방장 플래그" on checkins
  for update using (
    exists (
      select 1 from groups
      where groups.id = checkins.group_id
        and groups.created_by = auth.uid()
    )
  );

-- 예외 신청
create table if not exists exemptions (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  week_number int not null,
  year int not null,
  reason text not null check (reason in ('military', 'travel', 'injury', 'other')),
  reason_detail text,
  reduced_target int not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz default now(),
  unique (group_id, user_id, week_number, year)
);

alter table exemptions enable row level security;

create policy "같은 그룹 예외 읽기" on exemptions
  for select using (
    exists (
      select 1 from members
      where members.group_id = exemptions.group_id
        and members.user_id = auth.uid()
    )
  );

create policy "본인 예외 신청" on exemptions
  for insert with check (auth.uid() = user_id);

create policy "방장 예외 처리" on exemptions
  for update using (
    exists (
      select 1 from groups
      where groups.id = exemptions.group_id
        and groups.created_by = auth.uid()
    )
  );

-- 벌금 (주간 마감 시 Edge Function이 기록)
create table if not exists penalties (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  week_number int not null,
  year int not null,
  missed_count int not null,
  amount int not null,
  finalized boolean default true,
  created_at timestamptz default now(),
  unique (group_id, user_id, week_number, year)
);

alter table penalties enable row level security;

create policy "같은 그룹 벌금 읽기" on penalties
  for select using (
    exists (
      select 1 from members
      where members.group_id = penalties.group_id
        and members.user_id = auth.uid()
    )
  );

-- Edge Function만 insert 가능 (service_role key 사용)
create policy "서비스 벌금 기록" on penalties
  for insert with check (true);

-- 체크인 사진 Storage bucket
-- Supabase Dashboard → Storage → New Bucket → checkin-photos (public: false)
-- 아래 정책은 Dashboard에서 설정하거나 SQL로:

-- insert into storage.buckets (id, name, public) values ('checkin-photos', 'checkin-photos', false);

-- Storage RLS (checkin-photos):
-- 멤버 읽기: 같은 그룹 멤버
-- 업로드: 인증된 사용자 (본인 경로에만)
