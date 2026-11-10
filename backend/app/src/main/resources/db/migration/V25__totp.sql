-- Story 11.14: two-factor sign-in (FR-44, ADR-19). One row per User who started setup; every value except the ids is an envelope.
-- state_ct is pending, active or reset (reset = an Admin cleared it; Profile shows a banner until the User sets it up again).
create table user_totp (
    id                uuid   primary key,
    user_id           uuid   not null unique references app_user (id) on delete cascade,
    version           bigint not null,
    secret_ct         bytea  not null,
    state_ct          bytea  not null,
    last_used_step_ct bytea  not null
);

-- Eight single-use recovery codes per User, stored as Argon2id hashes (inside an envelope). used_at_ct is null while unused.
create table recovery_code (
    id         uuid  primary key,
    user_id    uuid  not null references app_user (id) on delete cascade,
    hash_ct    bytea not null,
    used_at_ct bytea
);
create index recovery_code_user on recovery_code (user_id);
