-- Tag taxonomy and AI behavior settings (Story 3.2, architecture §4.3). Every business value is a *_ct envelope.
-- taxonomy_value: no blind index (tens of rows, decrypted in memory); rows are seeded by V10.
create table taxonomy_value (
    id uuid primary key,
    version bigint not null default 0,
    type_ct bytea not null,
    value_ct bytea not null
);

-- Grouping sensitivity, description tone, advanced model switch and its model. Null until the Admin saves them (the view applies the defaults).
alter table ai_setting
    add column vision_model_adv_ct bytea,
    add column sensitivity_ct bytea,
    add column tone_ct bytea,
    add column advanced_ct bytea;
