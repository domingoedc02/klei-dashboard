-- Story 8.1: the bell. seq is the plaintext ordering key (OQ-2), assigned by the database. Everything a person could read is an envelope.
create table notification (
    id            uuid   primary key,
    user_id       uuid   not null references app_user (id) on delete cascade,
    seq           bigint generated always as identity,
    type_ct       bytea  not null,
    title_ct      bytea  not null,
    target_ct     bytea,
    read_ct       bytea  not null,
    created_at_ct bytea  not null
);
create index notification_user on notification (user_id, seq desc);
