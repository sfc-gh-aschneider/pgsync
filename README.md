# PG Sync — Snowflake to Postgres Sync Manager

Synchronizes data, roles, users, and security policies between Snowflake and Snowflake Postgres.

**Repository:** https://github.com/sfc-gh-aschneider/pgsync

## Deployment

1. Open a **SQL Worksheet** in Snowsight
2. Paste the contents of `deploy.sql`
3. Fill in the 3 variables at the top (PG host, host:port, and password)
4. Run all statements top to bottom

The script will set up everything: database, git integration, procedures, and connectivity.

After that, deploy the web app from a terminal:

```bash
git clone https://github.com/sfc-gh-aschneider/pgsync.git
cd pgsync/src

# Default connection:
snow app deploy --entity-id pg_sync

# Or specify a connection:
snow app deploy --entity-id pg_sync --connection <YOUR_CONNECTION_NAME>
```

Then attach the EAI (in Snowsight):

```sql
ALTER APPLICATION SERVICE PGSYNC_DB.APP.PG_SYNC
  SET EXTERNAL_ACCESS_INTEGRATIONS = (PGSYNC_PG_EAI);
```

Get your app URL:

```sql
SHOW APPLICATION SERVICES LIKE 'PG_SYNC' IN SCHEMA PGSYNC_DB.APP;
```

## What It Syncs

| Feature | Direction | Modes |
|---------|-----------|-------|
| Table data | SF → PG | FULL (drop+recreate) or INCREMENTAL (watermark) |
| Table data | PG → SF | FULL (truncate+insert) or INCREMENTAL (watermark) |
| Roles | SF → PG | Creates PG roles, syncs grants (TABLE/VIEW/DYNAMIC_TABLE) |
| Users | SF → PG | Creates PG users, assigns roles, sets passwords |
| Policies | SF → PG | Row-Level Security, column restrictions |

## Multiple Postgres Databases

A Postgres connection targets one database at a time. The default entry uses the `postgres` database. To sync to additional databases on the same instance, insert another row:

```sql
INSERT INTO PGSYNC_DB.METADATA.SYNC_INSTANCES (
    INSTANCE_NAME, PG_HOST, PG_PORT, PG_DATABASE, PG_SERVICE_USER,
    SECRET_NAME, NETWORK_RULE_NAME, EAI_NAME, NOTES
) VALUES (
    'MY_PG', '<same_host>', 5432, '<other_database>',
    'snowflake_admin', 'PGSYNC_DB.METADATA.PG_SECRET',
    'PGSYNC_DB.METADATA.PGSYNC_NETWORK_RULE', 'PGSYNC_PG_EAI', 'Second database'
);
```

Then reference the new `INSTANCE_ID` when adding sync configs.

## Updating

```sql
-- Pull latest code from GitHub
ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH;

-- Re-run deploy.sql to recreate procedures with updated code
```

For web app updates:

```bash
cd pgsync/src
git pull
snow app deploy --entity-id pg_sync
```
