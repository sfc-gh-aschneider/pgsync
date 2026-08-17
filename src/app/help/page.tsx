import { BookOpen } from "lucide-react"

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Help & Connection Guide</h1>
        <p className="text-sm text-muted-foreground mt-1">How to connect your applications to Snowflake Postgres</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold border-b pb-2">Authentication Modes</h2>
        <p className="text-sm">Your Postgres instance supports two authentication methods (POSTGRES_OR_SNOWFLAKE mode):</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded-lg p-4 space-y-2">
            <h3 className="font-medium text-sm">Password Auth</h3>
            <p className="text-xs text-muted-foreground">For service accounts and applications. PG user authenticates with a static password stored in your app config or key vault.</p>
            <code className="text-xs block bg-muted p-2 rounded">user=app_medical password=*** host=...</code>
          </div>
          <div className="border rounded-lg p-4 space-y-2">
            <h3 className="font-medium text-sm">Snowflake Token Auth</h3>
            <p className="text-xs text-muted-foreground">For individual users. PG user has snowflake.user attribute set. Auth via short-lived JWT token from Snowflake.</p>
            <code className="text-xs block bg-muted p-2 rounded">user=bob password=&lt;jwt_token&gt; host=...</code>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold border-b pb-2">Pattern 1: App Service Account (Recommended)</h2>
        <p className="text-sm">Most applications should use a dedicated service account. The app handles user authorization internally.</p>
        <div className="bg-muted/50 border rounded-lg p-4 space-y-3 text-sm">
          <p className="font-medium">Setup steps:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Create an App Service Account in <strong>User Sync → App Service Accounts</strong></li>
            <li>Assign the appropriate roles (e.g. <code>coaching_staff</code>)</li>
            <li>Click <strong>Sync All Users</strong> to create the PG user</li>
            <li>Store the password securely in your app (Azure Key Vault, env var, etc.)</li>
          </ol>
          <p className="font-medium mt-3">Connection string for your app:</p>
          <pre className="bg-background border rounded p-2 text-xs overflow-auto">{`postgresql://app_medical:<password>@<pg_host>:5432/postgres?sslmode=require`}</pre>
          <p className="font-medium mt-3">Example (Node.js):</p>
          <pre className="bg-background border rounded p-2 text-xs overflow-auto">{`const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.PG_HOST,
  port: 5432,
  database: 'postgres',
  user: 'app_medical',
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const result = await pool.query('SELECT * FROM pgsync.player_dim');`}</pre>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold border-b pb-2">Pattern 2: Per-User Token Auth (Sensitive Data)</h2>
        <p className="text-sm">For apps that need database-level access control (RLS, column restrictions). Each user connects as themselves.</p>
        <div className="bg-muted/50 border rounded-lg p-4 space-y-3 text-sm">
          <p className="font-medium">Setup steps:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Sync individual users in <strong>User Sync → Individual User Accounts</strong></li>
            <li>The sync creates PG users with <code>snowflake.user</code> mapping</li>
            <li>Configure RLS policies in <strong>Policies</strong> page</li>
            <li>Your app generates per-user tokens at auth time</li>
          </ol>
          <p className="font-medium mt-3">Token generation (from your app backend):</p>
          <pre className="bg-background border rounded p-2 text-xs overflow-auto">{`-- Your app's Snowflake service account runs:
SELECT GENERATE_POSTGRES_ACCESS_TOKEN_FOR_USER(
  '<instance_name>', '<pg_username>'
) AS TOKEN;

-- Token is a JWT valid for 15 minutes
-- Pass it as the password when connecting to PG`}</pre>
          <p className="font-medium mt-3">Example (Node.js with Snowflake SDK):</p>
          <pre className="bg-background border rounded p-2 text-xs overflow-auto">{`// 1. Generate token via Snowflake
const [{ TOKEN }] = await snowflake.execute(
  "SELECT GENERATE_POSTGRES_ACCESS_TOKEN_FOR_USER('AFL_PG', 'bob') AS TOKEN"
);

// 2. Connect to PG as the user
const pool = new Pool({
  host: process.env.PG_HOST,
  user: 'bob',
  password: TOKEN,  // JWT token as password
  ssl: { rejectUnauthorized: false }
});

// 3. RLS policies automatically filter data for bob
const result = await pool.query('SELECT * FROM pgsync.player_dim');`}</pre>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold border-b pb-2">Network Configuration</h2>
        <div className="text-sm space-y-2">
          <p>Your application needs network access to the Postgres instance:</p>
          <ul className="list-disc list-inside text-xs space-y-1">
            <li><strong>Host:</strong> Found in the instance details (e.g. <code>*.sfseapac-ant.ap-southeast-2.aws.postgres.snowflake.app</code>)</li>
            <li><strong>Port:</strong> 5432</li>
            <li><strong>SSL:</strong> Required (sslmode=require minimum)</li>
            <li><strong>Network Policy:</strong> Ensure your app's outbound IP is allowed in the PG instance network policy</li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold border-b pb-2">Sync Architecture</h2>
        <div className="text-sm space-y-2">
          <p>All sync logic runs as Snowflake stored procedures. The app calls them via SQL:</p>
          <pre className="bg-muted border rounded p-2 text-xs overflow-auto">{`-- Sync a single table
CALL PGSYNC_DB.PROCEDURES.SYNC_DATA(<config_id>);

-- Sync all data for an instance
CALL PGSYNC_DB.PROCEDURES.SYNC_ALL_DATA(<instance_id>);

-- Sync roles and grants
CALL PGSYNC_DB.PROCEDURES.SYNC_ROLES(<instance_id>);

-- Sync users
CALL PGSYNC_DB.PROCEDURES.SYNC_USERS(<instance_id>);

-- Pre-check a role before syncing
CALL PGSYNC_DB.PROCEDURES.PRECHECK_ROLE('<role_name>', <instance_id>);

-- Apply security policies
CALL PGSYNC_DB.PROCEDURES.SYNC_POLICIES(<instance_id>);`}</pre>
        </div>
      </section>
    </div>
  )
}
