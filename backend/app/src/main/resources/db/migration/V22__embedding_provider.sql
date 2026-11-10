-- Optional separate provider for image embeddings: its own address and key. Null means "use the main provider".
-- Every business value is a *_ct envelope.
alter table ai_setting
    add column embedding_base_url_ct bytea,
    add column embedding_api_key_ct bytea;
