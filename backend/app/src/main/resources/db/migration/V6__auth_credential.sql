-- One-time credentials (Story 2.1): invite, verify, reset. Found by secret_bidx; consumed by deleting the row.
-- code_ct holds the HMAC of a 6-digit code, never the code. invited_by_id and role_id carry what the invite page shows.
create table auth_credential (
    id            uuid   primary key,
    version       bigint not null,
    user_id       uuid   not null references app_user (id),
    kind_ct       bytea  not null,
    secret_ct     bytea  not null,
    secret_bidx   bytea  not null unique,
    code_ct       bytea,
    invited_by_id uuid   references app_user (id),
    role_id       uuid   references role (id),
    expires_at_ct bytea  not null,
    attempts_ct   bytea  not null
);
create index auth_credential_user on auth_credential (user_id);
