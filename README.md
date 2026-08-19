# PG Sync — Snowflake to Postgres Sync Manager

Synchronizes data, roles, users, and security policies between Snowflake and Snowflake Postgres.

## Deployment

1. Open a **SQL Worksheet** in Snowsight
2. Paste the contents of [`deploy.sql`](deploy.sql)
3. Fill in the variables at the top (PG host, host:port, password)
4. Run all statements top to bottom

Then deploy the web app:

```bash
git clone https://github.com/sfc-gh-aschneider/pgsync.git
cd pgsync/src
snow app deploy --entity-id pg_sync --connection <YOUR_CONNECTION_NAME>
```

Get your app URL:

```sql
SHOW APPLICATION SERVICES LIKE 'PG_SYNC' IN SCHEMA PGSYNC_DB.APP;
```

## Adding Postgres Instances

Use the **Admin** page in the app. Select your Postgres instance, enter credentials, test the connection, and choose which databases to add. The app handles secrets and procedure bindings automatically.

## What It Does

| Feature | Description |
|---------|-------------|
| Data Sync | Sync tables between SF and PG (full or incremental) |
| Role Sync | Replicate SF role grants to PG (for actively synced tables) |
| User Sync | Create PG users with role assignments |
| Security Policies | Apply RLS and column restrictions to PG tables |
| Automation | Schedule syncs with Snowflake Tasks |

## Updating

```bash
# Pull latest app code and redeploy
cd pgsync/src
git pull
snow app deploy --entity-id pg_sync

# Pull latest procedure code into Snowflake
# (run in a worksheet)
ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH;
```
