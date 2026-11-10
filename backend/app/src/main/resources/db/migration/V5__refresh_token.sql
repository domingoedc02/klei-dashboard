-- Refresh tokens (Story 1.6). The opaque token is found by its blind index; expiry and spent time are decrypted in memory.
-- family_id groups one sign-in's rotations so reuse of a spent token revokes the whole family.
create table refresh_token (
    id            uuid   primary key,
    version       bigint not null,
    user_id       uuid   not null references app_user (id),
    family_id     uuid   not null,
    token_ct      bytea  not null,
    token_bidx    bytea  not null unique,
    expires_at_ct bytea  not null,
    spent_at_ct   bytea,
    successor_id  uuid   references refresh_token (id)
);
create index refresh_token_family on refresh_token (family_id);
create index refresh_token_user on refresh_token (user_id);
