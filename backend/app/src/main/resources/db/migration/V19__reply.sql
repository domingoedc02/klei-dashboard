-- Story 7.3: a reply is a Message with a mail outcome; files and drafts are envelopes. No plaintext business value.
alter table message
    add column mail_state_ct bytea,
    add column mail_at_ct    bytea;

-- message_id is null until the Reply that carries the file is sent; unsent files are swept after 24 hours.
create table attachment (
    id         uuid  primary key,
    inquiry_id uuid  not null references inquiry (id) on delete cascade,
    message_id uuid  references message (id) on delete cascade,
    user_id    uuid  references app_user (id) on delete set null,
    object_id  uuid  not null references stored_object (id),
    idem_bidx  bytea,
    name_ct    bytea not null,
    size_ct    bytea not null,
    created_at_ct bytea not null
);
create index attachment_inquiry on attachment (inquiry_id);
create index attachment_message on attachment (message_id);
create unique index attachment_idem on attachment (idem_bidx) where idem_bidx is not null;

-- One draft per Inquiry per User.
create table draft (
    id            uuid  primary key,
    inquiry_id    uuid  not null references inquiry (id) on delete cascade,
    user_id       uuid  not null references app_user (id) on delete cascade,
    body_ct       bytea not null,
    updated_at_ct bytea not null,
    unique (inquiry_id, user_id)
);
