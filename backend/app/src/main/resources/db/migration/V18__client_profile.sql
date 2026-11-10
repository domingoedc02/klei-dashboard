-- Client profile fields (Story 7.2 reads them, Story 7.4 edits them). All optional, all envelopes.
alter table client
    add column phone_ct        bytea,
    add column city_ct         bytea,
    add column wedding_date_ct bytea,
    add column source_ct       bytea,
    add column note_ct         bytea;
