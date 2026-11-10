-- Upload batches and photos (Story 4.1, architecture §4.3, §5.5). Every business value is a *_ct envelope.
-- created_at_ct is null for objects that predate it; the orphan sweep skips those rows.
alter table stored_object add column created_at_ct bytea;

-- One active batch per User. Deleting a User discards the batch first, in code, so object deletes can follow the commit.
create table upload_batch (
    id            uuid   primary key,
    version       bigint not null,
    user_id       uuid   not null unique references app_user (id),
    phase_ct      bytea  not null,
    progress_ct   bytea,
    error_ct      bytea,
    rejected_ct   bytea  not null,
    created_at_ct bytea  not null
);

-- gown_id and group_id stay plain uuids without a foreign key until the gown and grouping tables exist (Stories 4.3, 4.5).
create table photo (
    id                 uuid   primary key,
    batch_id           uuid   not null references upload_batch (id),
    gown_id            uuid,
    group_id           uuid,
    original_object_id uuid   not null references stored_object (id),
    thumb_object_id    uuid   not null references stored_object (id),
    filename_ct        bytea  not null,
    content_type_ct    bytea  not null,
    size_ct            bytea  not null,
    idem_bidx          bytea  not null,
    created_at_ct      bytea  not null,
    unique (batch_id, idem_bidx)
);
create index photo_batch on photo (batch_id);
create index photo_original on photo (original_object_id);
create index photo_thumb on photo (thumb_object_id);
