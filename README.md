# PG Sync — Snowflake to Postgres Sync Manager

Synchronizes data, roles, users, and security policies between Snowflake and Snowflake Postgres.

---

## Quick Start

```
1. Create git integration in Snowflake  (one-time, ~2 min)
2. Set up Postgres networking           (one-time, ~2 min)
3. Run deploy.sql                       (creates everything)
4. Clone repo + snow app deploy         (deploys the web UI)
```

---

## Step 1: Connect This Repo to Snowflake

**Create the Snowflake git integration:**

```sql
-- Create database and schemas as SYSADMIN (so SYSADMIN owns them)
USE ROLE SYSADMIN;

CREATE DATABASE IF NOT EXISTS PGSYNC_DB;
CREATE SCHEMA IF NOT EXISTS PGSYNC_DB.METADATA;
CREATE SCHEMA IF NOT EXISTS PGSYNC_DB.PROCEDURES;

-- API integration requires ACCOUNTADMIN
USE ROLE ACCOUNTADMIN;

CREATE OR REPLACE API INTEGRATION PGSYNC_GIT_INTEGRATION
    API_PROVIDER = GIT_HTTPS_API
    API_ALLOWED_PREFIXES = ('https://github.com/sfc-gh-aschneider/')
    ENABLED = TRUE;

GRANT USAGE ON INTEGRATION PGSYNC_GIT_INTEGRATION TO ROLE SYSADMIN;

-- Back to SYSADMIN for the git repo object
USE ROLE SYSADMIN;

CREATE OR REPLACE GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO
    API_INTEGRATION = PGSYNC_GIT_INTEGRATION
    ORIGIN = 'https://github.com/sfc-gh-aschneider/pgsync.git';

-- Verify it works
ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH;
LS @PGSYNC_DB.PROCEDURES.PGSYNC_REPO/branches/main/procedures/;
```

You should see the procedure `.py` files listed.

---

## Step 2: Set Up Postgres Networking

Your Postgres instance needs a network policy that allows Snowflake's egress IPs to connect.

**Get your account's egress IP ranges:**

```sql
SELECT
  value:"ipv4_prefix"::VARCHAR AS ip_cidr,
  value:"expires"::TIMESTAMP AS expires
FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));
```

**Create network policy and attach to your instance:**

```sql
USE ROLE ACCOUNTADMIN;

-- Use ALL CIDR ranges returned by the query above
CREATE OR REPLACE NETWORK RULE PGSYNC_DB.METADATA.PG_INGRESS_NR
  TYPE = IPV4
  MODE = POSTGRES_INGRESS
  VALUE_LIST = ('<<CIDR_1>>', '<<CIDR_2>>');

CREATE OR REPLACE NETWORK POLICY PGSYNC_PG_NETWORK_POLICY
  ALLOWED_NETWORK_RULE_LIST = (PGSYNC_DB.METADATA.PG_INGRESS_NR);

ALTER POSTGRES INSTANCE <<YOUR_INSTANCE>> SET NETWORK_POLICY = PGSYNC_PG_NETWORK_POLICY;
```

> Egress IPs rotate ~quarterly. New ranges appear 60 days before activation.
> Check monthly and update the network rule as needed.

---

## Step 3: Run deploy.sql

Edit the **CONFIGURATION** section at the top of `deploy.sql`:

| Variable | Description | Example |
|----------|-------------|---------|
| `pg_host` | From `DESCRIBE POSTGRES INSTANCE` | `abc123.your-account.region.aws.postgres.snowflake.app` |
| `pg_username` | PG service account | `snowflake_admin` |
| `pg_password` | From instance creation or RESET ACCESS | — |
| `pg_instance_name` | Friendly name for registry | `MY_PG` |

Then run it in Snowsight, or via git:

```sql
EXECUTE IMMEDIATE FROM @PGSYNC_DB.PROCEDURES.PGSYNC_REPO/branches/main/deploy.sql;
```

This creates: database, metadata tables, secret, EAI, network rule, and all stored procedures (loaded directly from git — no file uploads needed).

**Verify connectivity:**
```sql
CALL PGSYNC_DB.PROCEDURES.PG_QUERY(1, 'SELECT current_database() as db, current_user as usr');
SELECT TO_VARCHAR("PG_QUERY") FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
```

---

## Step 4: Deploy the Web App

Clone this repo locally:

```bash
git clone https://github.com/sfc-gh-aschneider/pgsync.git
cd pgsync/src
```

Edit `snowflake.yml` — set your target database, schema, and warehouse:

```yaml
    identifier:
      name: PG_SYNC
      database: <<YOUR_APP_DATABASE>>    # e.g. MY_APPS
      schema: <<YOUR_APP_SCHEMA>>        # e.g. PUBLIC
    query_warehouse: <<YOUR_WAREHOUSE>>  # e.g. COMPUTE_WH
```

Build and deploy:

```bash
npm ci --include=dev
snow app deploy --entity pg_sync
```

Attach the EAI to the app service:

```sql
ALTER APPLICATION SERVICE <<YOUR_APP_DATABASE>>.<<YOUR_APP_SCHEMA>>.PG_SYNC
  SET EXTERNAL_ACCESS_INTEGRATIONS = (PGSYNC_PG_EAI);
```

Get your app URL:

```sql
SHOW APPLICATION SERVICES LIKE 'PG_SYNC';
-- The "url" column is your app URL
```

---

## Updating

When we push updates to this repo:

```sql
ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH;
-- Re-run deploy.sql to recreate procedures with latest code
EXECUTE IMMEDIATE FROM @PGSYNC_DB.PROCEDURES.PGSYNC_REPO/branches/main/deploy.sql;
```

For web app updates:

```bash
cd pgsync/src
git pull
snow app deploy --entity pg_sync
```

---

## What It Syncs

| Feature | Direction | Modes |
|---------|-----------|-------|
| Table data | SF → PG | FULL (drop+recreate) or INCREMENTAL (watermark) |
| Table data | PG → SF | FULL (truncate+insert) or INCREMENTAL (watermark) |
| Roles | SF → PG | Creates PG roles, syncs grants (SELECT/INSERT/UPDATE/DELETE) |
| Users | SF → PG | Creates PG users, assigns roles, sets passwords |
| Policies | SF → PG | Row-Level Security, column restrictions |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Cannot connect to Postgres" | Ensure POSTGRES_INGRESS network policy is attached to instance with Snowflake egress IPs |
| Connectivity breaks after EAI change | Re-run `deploy.sql` to recreate procedures with fresh EAI binding |
| Role sync: 0 grants applied | Sync data first (tables must exist in PG before grants can be applied) |
| User sync: SET_SF_USER failed | Platform restriction — users/roles are still created correctly |
