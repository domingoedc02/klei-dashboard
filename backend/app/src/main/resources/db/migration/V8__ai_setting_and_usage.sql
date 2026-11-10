-- AI provider settings and the per-call usage log (Story 3.1, architecture §4.3). Every business value is a *_ct envelope.
-- ai_setting is one row with a fixed id, created by the first save. Grouping, tone and taxonomy columns arrive with Story 3.2.
-- models_ct holds the model ids from the last successful Test connection, one per line.
create table ai_setting (
    id                 uuid   primary key,
    version            bigint not null,
    preset_ct          bytea  not null,
    base_url_ct        bytea  not null,
    api_key_ct         bytea,
    organization_ct    bytea,
    chat_model_ct      bytea,
    vision_model_ct    bytea,
    embedding_model_ct bytea  not null,
    temperature_ct     bytea  not null,
    max_tokens_ct      bytea  not null,
    status_ct          bytea  not null,
    tested_at_ct       bytea,
    models_ct          bytea
);

-- Written in its own transaction for every AI call, failures included. No FK on user_id: a deleted User keeps their rows.
create table ai_usage (
    id            uuid   primary key,
    seq           bigint generated always as identity,
    user_id       uuid,
    purpose_ct    bytea  not null,
    model_ct      bytea,
    size_ct       bytea,
    outcome_ct    bytea  not null,
    duration_ct   bytea  not null,
    prompt_ct     bytea,
    response_ct   bytea,
    created_at_ct bytea  not null
);
create unique index ai_usage_seq on ai_usage (seq);
