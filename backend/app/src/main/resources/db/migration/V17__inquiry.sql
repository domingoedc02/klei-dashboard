-- Clients and their Inquiries (Story 7.1, architecture §4.3). Every business value is a *_ct envelope; seq is the accepted plaintext ordering key (OQ-2).
-- email_bidx, status_bidx, unread_bidx, idem_bidx and inquiry_term.term_bidx are HMACs (architecture §4.2).
-- inquiry.seq is moved to a fresh value of inquiry_activity_seq by InquiryStateService.touch() only, so newest activity sorts first.
create sequence inquiry_activity_seq;

create table client (
    id            uuid   primary key,
    version       bigint not null,
    name_ct       bytea  not null,
    email_ct      bytea  not null,
    email_bidx    bytea  not null,
    created_at_ct bytea  not null
);
create unique index client_email on client (email_bidx);

-- A Client with Inquiries cannot be removed (restrict).
create table inquiry (
    id                 uuid   primary key,
    version            bigint not null,
    client_id          uuid   not null references client (id) on delete restrict,
    seq                bigint not null,
    subject_ct         bytea  not null,
    preview_ct         bytea  not null,
    status_ct          bytea  not null,
    status_bidx        bytea  not null,
    unread_ct          bytea  not null,
    unread_bidx        bytea  not null,
    last_message_at_ct bytea  not null
);
create index inquiry_seq        on inquiry (seq desc);
create index inquiry_status_seq on inquiry (status_bidx, seq desc);
create index inquiry_state      on inquiry (status_bidx, unread_bidx);
create index inquiry_client     on inquiry (client_id);

create table inquiry_term (
    id         uuid  primary key,
    inquiry_id uuid  not null references inquiry (id) on delete cascade,
    term_bidx  bytea not null,
    unique (inquiry_id, term_bidx)
);
create index inquiry_term_term on inquiry_term (term_bidx);

-- author_user_id is null for a Client's message. Deleting a User keeps the Message.
create table message (
    id             uuid   primary key,
    inquiry_id     uuid   not null references inquiry (id) on delete cascade,
    seq            bigint generated always as identity,
    author_user_id uuid   references app_user (id) on delete set null,
    direction_ct   bytea  not null,
    body_ct        bytea  not null,
    idem_bidx      bytea,
    created_at_ct  bytea  not null
);
create index message_inquiry on message (inquiry_id, seq);
create unique index message_idem on message (idem_bidx) where idem_bidx is not null;
