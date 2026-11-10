-- Story 11.13: when each digest User was last mailed (FR-34). One row per User on Hourly, Daily or Weekly; the job locks it (`for update skip locked`).
create table notification_digest (
    id             uuid  primary key references app_user (id) on delete cascade,
    last_digest_at_ct bytea not null
);
