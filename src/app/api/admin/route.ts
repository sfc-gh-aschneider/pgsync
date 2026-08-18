import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

const STANDARD_NETWORK_RULE = "PGSYNC_DB.METADATA.PGSYNC_NETWORK_RULE"
const STANDARD_EAI = "PGSYNC_PG_EAI"

async function getAllSecrets(): Promise<string[]> {
  const instances = await querySnowflake(
    `SELECT INSTANCE_ID, SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE`
  )
  const secrets = instances
    .map((i: any) => i.SECRET_NAME)
    .filter((s: string) => s)
  // Always include the default secret
  if (!secrets.includes("PGSYNC_DB.METADATA.PG_SECRET")) {
    secrets.push("PGSYNC_DB.METADATA.PG_SECRET")
  }
  return [...new Set(secrets)]
}

async function rebuildEai() {
  const secrets = await getAllSecrets()
  const secretList = secrets.join(", ")
  await querySnowflake(`USE ROLE ACCOUNTADMIN`)
  await querySnowflake(
    `CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION ${STANDARD_EAI}
     ALLOWED_NETWORK_RULES = (${STANDARD_NETWORK_RULE})
     ALLOWED_AUTHENTICATION_SECRETS = (${secretList})
     ENABLED = TRUE`
  )
  await querySnowflake(`GRANT USAGE ON INTEGRATION ${STANDARD_EAI} TO ROLE SYSADMIN`)
  await querySnowflake(`USE ROLE SYSADMIN`)
}

async function rebuildProcedures() {
  // Build SECRETS clause with all instance secrets
  const instances = await querySnowflake(
    `SELECT INSTANCE_ID, SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE AND SECRET_NAME IS NOT NULL`
  )
  const secretEntries = instances.map((i: any) => `'pg_secret_${i.INSTANCE_ID}' = ${i.SECRET_NAME}`)
  // Always include the default fallback
  secretEntries.push(`'pg_secret' = PGSYNC_DB.METADATA.PG_SECRET`)
  const secretsClause = secretEntries.join(", ")

  const gitPath = "@PGSYNC_DB.PROCEDURES.PGSYNC_REPO/branches/main/procedures"

  // Procedures that need PG access (EAI + secrets)
  const pgProcs = [
    { name: "PG_QUERY", args: "INSTANCE_ID NUMBER, SQL_TEXT VARCHAR", handler: "pg_query.run", file: "pg_query.py" },
    { name: "SYNC_DATA", args: "CONFIG_ID NUMBER", handler: "sync_data.run", file: "sync_data.py" },
    { name: "SYNC_ROLES", args: "INSTANCE_ID NUMBER", handler: "sync_roles.run", file: "sync_roles.py" },
    { name: "SYNC_USERS", args: "INSTANCE_ID NUMBER", handler: "sync_users.run", file: "sync_users.py" },
    { name: "SYNC_POLICIES", args: "INSTANCE_ID NUMBER", handler: "sync_policies.run", file: "sync_policies.py" },
    { name: "PRECHECK_ROLE", args: "ROLE_NAME VARCHAR, INSTANCE_ID NUMBER", handler: "precheck_role.run", file: "precheck_role.py" },
  ]

  for (const proc of pgProcs) {
    await querySnowflake(
      `CREATE OR REPLACE PROCEDURE PGSYNC_DB.PROCEDURES.${proc.name}(${proc.args})
       RETURNS VARIANT LANGUAGE PYTHON RUNTIME_VERSION = '3.11'
       PACKAGES = ('snowflake-snowpark-python', 'pg8000')
       HANDLER = '${proc.handler}'
       IMPORTS = ('${gitPath}/${proc.file}')
       EXTERNAL_ACCESS_INTEGRATIONS = (${STANDARD_EAI})
       SECRETS = (${secretsClause})
       EXECUTE AS CALLER`
    )
  }

  // Procedures that don't need PG access
  const noEaiProcs = [
    { name: "SYNC_ALL_DATA", args: "INSTANCE_ID NUMBER", handler: "sync_all_data.run", file: "sync_all_data.py" },
    { name: "RUN_FULL_SYNC", args: "INSTANCE_ID NUMBER", handler: "run_full_sync.run", file: "run_full_sync.py" },
  ]
  for (const proc of noEaiProcs) {
    await querySnowflake(
      `CREATE OR REPLACE PROCEDURE PGSYNC_DB.PROCEDURES.${proc.name}(${proc.args})
       RETURNS VARIANT LANGUAGE PYTHON RUNTIME_VERSION = '3.11'
       PACKAGES = ('snowflake-snowpark-python')
       HANDLER = '${proc.handler}'
       IMPORTS = ('${gitPath}/${proc.file}')
       EXECUTE AS CALLER`
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    switch (action) {
      case "add_instance": {
        const { name, host, port, database, service_user, password } = params
        const secretName = `PGSYNC_DB.METADATA.PG_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`

        // Create a secret for this instance
        await querySnowflake(
          `CREATE OR REPLACE SECRET ${secretName} TYPE = PASSWORD USERNAME = '${service_user || "snowflake_admin"}' PASSWORD = '${password}'`
        )

        // Insert instance row
        await querySnowflake(
          `INSERT INTO PGSYNC_DB.METADATA.SYNC_INSTANCES 
           (INSTANCE_NAME, PG_HOST, PG_PORT, PG_DATABASE, PG_SERVICE_USER, SECRET_NAME, NETWORK_RULE_NAME, EAI_NAME)
           VALUES ('${name}', '${host}', ${port || 5432}, '${database || "postgres"}', '${service_user || "snowflake_admin"}', '${secretName}', '${STANDARD_NETWORK_RULE}', '${STANDARD_EAI}')`
        )

        // Update network rule to include new host
        const allInstances = await querySnowflake(
          `SELECT PG_HOST, PG_PORT FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE`
        )
        const allHosts = allInstances.map((i: any) => `'${i.PG_HOST}:${i.PG_PORT || 5432}'`).join(", ")
        await querySnowflake(
          `CREATE OR REPLACE NETWORK RULE ${STANDARD_NETWORK_RULE} TYPE = 'HOST_PORT' MODE = 'EGRESS' VALUE_LIST = (${allHosts})`
        )

        // Rebuild EAI with all secrets + recreate procedures
        await rebuildEai()
        await querySnowflake(`ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH`)
        await rebuildProcedures()

        return Response.json({ success: true, message: "Instance added, credentials stored, procedures rebuilt." })
      }

      case "test_connection": {
        const inst = await querySnowflake(
          `SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (!inst.length) return Response.json({ error: "Instance not found" }, { status: 404 })

        try {
          const result = await querySnowflake(
            `CALL PGSYNC_DB.PROCEDURES.PG_QUERY(${params.instance_id}, 'SELECT current_database() as db, current_user as usr')`
          )
          const parsed = result[0]?.PG_QUERY
          if (parsed && typeof parsed === "object" && parsed.status === "SUCCESS") {
            return Response.json({ status: "connected", db: parsed.rows?.[0]?.db, user: parsed.rows?.[0]?.usr })
          } else if (parsed && parsed.error) {
            const err = parsed.error
            if (err.includes("Cannot connect") || err.includes("timed out")) {
              return Response.json({ status: "network_error", error: "Cannot reach Postgres. Check: 1) Instance has a POSTGRES_INGRESS network policy with Snowflake egress IPs, 2) Instance is in READY state." })
            } else if (err.includes("password") || err.includes("authentication")) {
              return Response.json({ status: "auth_error", error: "Authentication failed. Check username and password for this instance." })
            }
            return Response.json({ status: "error", error: err })
          }
          return Response.json({ status: "error", error: "Unexpected response from PG_QUERY" })
        } catch (e: any) {
          return Response.json({ status: "error", error: e.message || "Test failed" })
        }
      }

      case "check_network": {
        const inst = await querySnowflake(
          `SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (!inst.length) return Response.json({ error: "Instance not found" }, { status: 404 })
        const instance = inst[0]
        const host = instance.PG_HOST

        let ruleIncludesHost = false
        try {
          const rules = await querySnowflake(`DESCRIBE NETWORK RULE ${STANDARD_NETWORK_RULE}`)
          const row = rules[0]
          const valueList = (row?.value_list || "").toLowerCase()
          ruleIncludesHost = valueList.includes(host.toLowerCase())
        } catch { /* rule doesn't exist */ }

        return Response.json({
          status: { rule_includes_host: ruleIncludesHost, host, message: ruleIncludesHost ? "Host in egress rule" : "Host NOT in egress rule" }
        })
      }

      case "remove_instance": {
        const deps = await querySnowflake(
          `SELECT COUNT(*) AS CNT FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (deps[0]?.CNT > 0) {
          return Response.json({ error: `Instance has ${deps[0].CNT} active sync configs. Remove them first.` }, { status: 400 })
        }
        // Get secret name before deleting
        const inst = await querySnowflake(
          `SELECT SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        await querySnowflake(
          `DELETE FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        // Drop the secret
        if (inst[0]?.SECRET_NAME && inst[0].SECRET_NAME !== "PGSYNC_DB.METADATA.PG_SECRET") {
          try { await querySnowflake(`DROP SECRET IF EXISTS ${inst[0].SECRET_NAME}`) } catch { /* ok */ }
        }
        // Rebuild EAI and procedures without this secret
        await rebuildEai()
        await rebuildProcedures()
        return Response.json({ success: true })
      }

      case "toggle_instance": {
        await querySnowflake(
          `UPDATE PGSYNC_DB.METADATA.SYNC_INSTANCES SET ENABLED = ${params.enabled}, UPDATED_AT = CURRENT_TIMESTAMP() WHERE INSTANCE_ID = ${params.instance_id}`
        )
        return Response.json({ success: true })
      }

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (e) {
    console.error("[admin API]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Admin operation failed" },
      { status: 500 }
    )
  }
}
