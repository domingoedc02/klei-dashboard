-- Tenant data keys, wrapped by a KEK (architecture §4.3, §5.2). Highest generation encrypts new data.
-- Concurrent first starts race on the unique generation; the loser's insert does nothing and re-reads.
create table data_key (
    id          uuid     primary key,
    generation  bigint   not null unique,
    wrapped_dek bytea    not null,
    kek_version integer  not null
);
