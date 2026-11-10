-- Preferences (Story 6.3): one structured value per User, so ciphertext like every other value.
alter table app_user add column prefs_ct bytea;
