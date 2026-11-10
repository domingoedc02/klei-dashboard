-- Staff "last active" (Story 2.3): an Instant, so ciphertext like every other value. Written at most once an hour per User.
alter table app_user add column last_active_ct bytea;
