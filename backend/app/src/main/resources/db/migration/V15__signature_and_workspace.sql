-- Reply signature per User and the Studio block every signature ends with (Story 6.2, FR-31). Every business value is a *_ct envelope.
-- signature: one row per User, created by their first save; removed with the User. version 0 in the API means "no row yet".
create table signature (
    user_id     uuid   primary key references app_user (id) on delete cascade,
    version     bigint not null,
    enabled_ct  bytea  not null,
    signoff_ct  bytea  not null,
    name_ct     bytea  not null,
    title_ct    bytea  not null,
    phone_ct    bytea  not null
);

-- workspace: one row with a fixed id, created by the first Admin save (same pattern as ai_setting).
create table workspace (
    id                uuid   primary key,
    version           bigint not null,
    studio_name_ct    bytea  not null,
    studio_address_ct bytea  not null
);
