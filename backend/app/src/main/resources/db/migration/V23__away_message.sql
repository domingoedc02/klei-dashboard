-- Story 11.12: the away message (FR-32). `away` is one row with a fixed id, created by the first save.
-- enabled_ct, message_ct and schedule_ct (a structured value with `v`) are envelopes; nothing about the schedule is readable here.
create table away (
    id          uuid   primary key,
    version     bigint not null,
    enabled_ct  bytea  not null,
    message_ct  bytea  not null,
    schedule_ct bytea  not null
);

-- One row per client per closure window that was sent the away message. Ids and an envelope; never an address.
create table away_sent (
    id              uuid  primary key,
    client_id       uuid  not null references client (id) on delete cascade,
    window_start_ct bytea not null
);
create index away_sent_client on away_sent (client_id);
