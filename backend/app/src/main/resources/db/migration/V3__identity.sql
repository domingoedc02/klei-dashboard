-- Identity and access, audit (architecture §4.3). Every business value is a *_ct envelope.
-- stored_object holds keys and wrap only for now; its *_ct columns arrive with the first upload (Story 4.1).
-- app_user.last_active_ct and prefs_ct arrive with the stories that write them (1.5, 6.3).
create table stored_object (
    id          uuid    primary key,
    wrapped_dek bytea   not null,
    kek_version integer not null
);

create table role (
    id      uuid   primary key,
    version bigint not null,
    name_ct bytea  not null
);

create table role_permission (
    id            uuid  primary key,
    role_id       uuid  not null references role (id) on delete cascade,
    permission_ct bytea not null
);
create index role_permission_role on role_permission (role_id);

-- The single epoch counter is the row's `version` (AD-9): the allowlist has no other plain counter.
create table permission_epoch (
    id      uuid   primary key,
    version bigint not null
);
insert into permission_epoch (id, version) values ('00000000-0000-4000-8000-000000000001', 1);

create table app_user (
    id               uuid   primary key,
    version          bigint not null,
    name_ct          bytea  not null,
    email_ct         bytea  not null,
    email_bidx       bytea  not null unique,
    password_ct      bytea  not null,
    role_id          uuid   not null references role (id),
    status_ct        bytea  not null,
    verified_ct      bytea  not null,
    avatar_object_id uuid   references stored_object (id),
    created_at_ct    bytea  not null
);
create index app_user_role on app_user (role_id);

create table audit_entry (
    id            uuid   primary key,
    seq           bigint generated always as identity,
    ts_ct         bytea  not null,
    actor_id_ct   bytea,
    actor_name_ct bytea  not null,
    action_ct     bytea  not null,
    detail_ct     bytea,
    ip_ct         bytea
);
create unique index audit_entry_seq on audit_entry (seq);

create function audit_entry_append_only() returns trigger language plpgsql as $$
begin
    raise exception 'audit_entry is append-only';
end
$$;
create trigger audit_entry_no_change before update or delete on audit_entry
    for each row execute function audit_entry_append_only();
create trigger audit_entry_no_truncate before truncate on audit_entry
    for each statement execute function audit_entry_append_only();
