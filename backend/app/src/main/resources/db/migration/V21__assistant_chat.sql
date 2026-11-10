-- Story 8.3: the assistant chat. One chat per User: its messages hang off the User, "New chat" deletes them.
-- No plaintext ordering key: a chat is capped at 100 messages and is sorted by its encrypted created_at after reading.
create table chat_message (
    id uuid primary key,
    user_id uuid not null references app_user (id) on delete cascade,
    role_ct bytea not null,
    text_ct bytea not null,
    gowns_ct bytea,
    created_at_ct bytea not null
);

create index chat_message_user on chat_message (user_id);
