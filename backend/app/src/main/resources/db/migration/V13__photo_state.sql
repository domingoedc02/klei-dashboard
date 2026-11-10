-- Review state of a Photo (Story 4.6): null while shown, "discarded" once dropped in review. Encrypted like every business value.
alter table photo add column state_ct bytea;
