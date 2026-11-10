-- Test-only proof tables for Story 1.3. Never in production migrations.
create table crypto_probe (
    id         uuid    primary key,
    version    bigint  not null,
    name_ct    bytea,
    email_ct   bytea,
    email_bidx bytea,
    seen_at_ct bytea,
    flag_ct    bytea,
    phase_ct   bytea,
    attrs_ct   bytea
);
create index crypto_probe_email_bidx on crypto_probe (email_bidx);

create table crypto_probe_2 (
    id      uuid   primary key,
    version bigint not null,
    name_ct bytea
);
