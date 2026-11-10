-- Embeddings and AI groups of an Upload Batch (Story 4.3, architecture §4.3). Every business value is a *_ct envelope.
-- Both tables die with their parent through the database, so Discard and Delete photo need no extra statement.

create table embedding (
    id        uuid   primary key,
    photo_id  uuid   not null unique references photo (id) on delete cascade,
    version   bigint not null,
    vector_ct bytea  not null,
    model_ct  bytea  not null,
    dim_ct    bytea  not null
);

create table upload_group (
    id             uuid   primary key,
    batch_id       uuid   not null references upload_batch (id) on delete cascade,
    version        bigint not null,
    name_ct        bytea  not null,
    attributes_ct  bytea  not null,
    description_ct bytea,
    confidence_ct  bytea  not null,
    position_ct    bytea  not null
);
create index upload_group_batch on upload_group (batch_id);
