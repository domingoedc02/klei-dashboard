-- Gowns saved from an Upload Batch (Story 4.7, architecture §4.3). Every business value is a *_ct envelope; seq is the accepted plaintext ordering key (OQ-2).
-- day_bidx and gown_term.term_bidx are HMACs (architecture §4.2). save_bidx is the HMAC of the batch id, so a repeated Save finds its Gowns after the batch is gone.
-- Deleting a User keeps the Gowns: created_by_id goes null.
create table gown (
    id            uuid   primary key,
    version       bigint not null,
    seq           bigint generated always as identity,
    name_ct       bytea  not null,
    description_ct bytea,
    confidence_ct bytea  not null,
    is_new_ct     bytea  not null,
    created_at_ct bytea  not null,
    day_bidx      bytea  not null,
    save_bidx     bytea  not null,
    created_by_id uuid   references app_user (id) on delete set null
);
create index gown_seq  on gown (seq desc);
create index gown_day  on gown (day_bidx);
create index gown_save on gown (save_bidx);

-- A tag value cannot be removed while a Gown points at it (restrict); the Taxonomy screen checks the count first.
create table gown_attribute (
    id                uuid primary key,
    gown_id           uuid not null references gown (id) on delete cascade,
    taxonomy_value_id uuid not null references taxonomy_value (id) on delete restrict,
    unique (gown_id, taxonomy_value_id)
);
create index gown_attribute_value on gown_attribute (taxonomy_value_id);

create table gown_term (
    id        uuid  primary key,
    gown_id   uuid  not null references gown (id) on delete cascade,
    term_bidx bytea not null,
    unique (gown_id, term_bidx)
);
create index gown_term_term on gown_term (term_bidx);

-- Saved Photos belong to a Gown, not to a batch. Removing a Gown deletes its Photos in code.
alter table photo alter column batch_id drop not null;
alter table photo add constraint photo_gown_fk foreign key (gown_id) references gown (id);
create index photo_gown on photo (gown_id);
