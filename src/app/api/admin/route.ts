import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

const STANDARD_NETWORK_RULE = "PGSYNC_DB.METADATA.PGSYNC_NETWORK_RULE"
const STANDARD_EAI = "PGSYNC_PG_EAI"

async function getAllSecrets(): Promise<string[]> {
  const instances = await querySnowflake(
    `SELECT DISTINCT SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE AND SECRET_NAME IS NOT NULL`
  )
  const secrets = instances.map((i: any) => i.SECRET_NAME).filter((s: string) => s)
  if (!secrets.includes("PGSYNC_DB.METADATA.PG_SECRET")) {
    secrets.push("PGSYNC_DB.METADATA.PG_SECRET")
  }
  return [...new Set(secrets)]
}

async function rebuildEai() {
  const secrets = await getAllSecrets()
  const secretList = secrets.join(", ")
  await querySnowflake(
    `ALTER EXTERNAL ACCESS INTEGRATION ${STANDARD_EAI} SET ALLOWED_AUTHENTICATION_SECRETS = (${secretList})`
  )
}

async function rebuildProcedures() {
  const instances = await querySnowflake(
    `SELECT DISTINCT INSTANCE_ID, SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE AND SECRET_NAME IS NOT NULL`
  )
  const secretEntries = instances.map((i: any) => `'pg_secret_${i.INSTANCE_ID}' = ${i.SECRET_NAME}`)
  secretEntries.push(`'pg_secret' = PGSYNC_DB.METADATA.PG_SECRET`)
  const secretsClause = [...new Set(secretEntries)].join(", ")
  const gitPath = "@PGSYNC_DB.PROCEDURES.PGSYNC_REPO/branches/main/procedures"

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

      case "list_pg_instances": {
        try {
          const rows = await querySnowflake(`SHOW POSTGRES INSTANCES`)
          const instances = rows.map((r: any) => ({
            name: r.name || r.NAME,
            host: r.host || r.HOST,
            state: r.state || r.STATE,
            network_policy: r.network_policy || r.NETWORK_POLICY || null,
            auth_authority: r.authentication_authority || r.AUTHENTICATION_AUTHORITY,
          }))
          return Response.json({ instances })
        } catch (e: any) {
          return Response.json({ instances: [], error: e.message })
        }
      }

      case "validate_instance": {
        const { instance_name } = params
        const checks: any[] = []

        // Get instance details
        let host = ""
        let networkPolicy = ""
        try {
          const desc = await querySnowflake(`DESCRIBE POSTGRES INSTANCE ${instance_name}`)
          const descMap = Object.fromEntries(desc.map((r: any) => [r.property, r.value]))
          host = descMap.host || ""
          networkPolicy = descMap.network_policy || ""
        } catch (e: any) {
          return Response.json({ passed: false, checks: [{ name: "Instance", ok: false, message: `Cannot describe instance: ${e.message}` }], commands: [] })
        }

        if (!networkPolicy) {
          checks.push({ name: "Network Policy", ok: false, message: "No network policy attached to this instance. A POSTGRES_INGRESS policy is required." })
          return Response.json({
            passed: false, checks, host,
            commands: [
              `-- Run as ACCOUNTADMIN:`,
              `-- First get your egress IP ranges:`,
              `SELECT value:"ipv4_prefix"::VARCHAR AS ip_cidr FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));`,
              ``,
              `-- Then create and attach a network policy:`,
              `CREATE NETWORK RULE PGSYNC_DB.METADATA.PG_INGRESS_${instance_name}`,
              `  TYPE = IPV4 MODE = POSTGRES_INGRESS`,
              `  VALUE_LIST = ('<cidr_1>', '<cidr_2>');`,
              ``,
              `CREATE NETWORK POLICY PGSYNC_INGRESS_POLICY_${instance_name}`,
              `  ALLOWED_NETWORK_RULE_LIST = (PGSYNC_DB.METADATA.PG_INGRESS_${instance_name});`,
              ``,
              `ALTER POSTGRES INSTANCE ${instance_name} SET NETWORK_POLICY = PGSYNC_INGRESS_POLICY_${instance_name};`,
            ]
          })
        }

        checks.push({ name: "Network Policy", ok: true, message: `Policy: ${networkPolicy}` })

        // Check if egress network rule includes this host
        let egressOk = false
        try {
          const rule = await querySnowflake(`DESCRIBE NETWORK RULE ${STANDARD_NETWORK_RULE}`)
          const valueList = (rule[0]?.value_list || "").toLowerCase()
          egressOk = valueList.includes(host.toLowerCase())
        } catch { /* rule might not exist */ }

        if (!egressOk) {
          checks.push({ name: "Egress Rule", ok: false, message: `Host ${host} not in egress network rule (${STANDARD_NETWORK_RULE}). The app cannot reach this instance.` })
          // Get current values
          let currentValues = ""
          try {
            const rule = await querySnowflake(`DESCRIBE NETWORK RULE ${STANDARD_NETWORK_RULE}`)
            currentValues = rule[0]?.value_list || ""
          } catch {}
          const newValueList = currentValues ? `${currentValues},${host}:5432` : `${host}:5432`
          return Response.json({
            passed: false, checks, host,
            commands: [
              `-- Run as ACCOUNTADMIN (or role with ownership on the network rule):`,
              `ALTER NETWORK RULE ${STANDARD_NETWORK_RULE}`,
              `  SET VALUE_LIST = ('${newValueList.split(",").join("', '")}');`,
              ``,
              `-- Then recreate the EAI to pick up the change:`,
              `CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION ${STANDARD_EAI}`,
              `  ALLOWED_NETWORK_RULES = (${STANDARD_NETWORK_RULE})`,
              `  ALLOWED_AUTHENTICATION_SECRETS = (${(await getAllSecrets()).join(", ")})`,
              `  ENABLED = TRUE;`,
            ]
          })
        }

        checks.push({ name: "Egress Rule", ok: true, message: `Host in egress rule` })

        // Check ingress (does PG's network policy include Snowflake egress IPs?)
        let ingressOk = false
        let ingressRule = ""
        try {
          const policyDesc = await querySnowflake(`DESCRIBE NETWORK POLICY ${networkPolicy}`)
          const ruleListRaw = policyDesc[0]?.value || "[]"
          const ruleList = JSON.parse(ruleListRaw)
          if (ruleList.length > 0) {
            ingressRule = ruleList[0].fullyQualifiedRuleName
            const ruleDesc = await querySnowflake(`DESCRIBE NETWORK RULE ${ingressRule}`)
            const ruleValues = (ruleDesc[0]?.value_list || "").toLowerCase()
            // Get egress ranges
            const egressRows = await querySnowflake(
              `SELECT value:"ipv4_prefix"::VARCHAR AS ip_cidr FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())))`
            )
            const egressCidrs = egressRows.map((r: any) => r.IP_CIDR)
            // Check if all egress CIDRs are in the ingress rule (or 0.0.0.0/0)
            if (ruleValues.includes("0.0.0.0/0")) {
              ingressOk = true
            } else {
              ingressOk = egressCidrs.every((cidr: string) => ruleValues.includes(cidr.toLowerCase()))
            }
          }
        } catch { /* couldn't check */ }

        if (!ingressOk) {
          checks.push({ name: "Ingress (Snowflake → PG)", ok: false, message: "Snowflake's egress IPs may not be in the instance's ingress rule. Connection may fail." })
          let egressCidrs: string[] = []
          try {
            const egressRows = await querySnowflake(
              `SELECT value:"ipv4_prefix"::VARCHAR AS ip_cidr FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())))`
            )
            egressCidrs = egressRows.map((r: any) => r.IP_CIDR)
          } catch {}
          return Response.json({
            passed: false, checks, host,
            commands: ingressRule ? [
              `-- Run as ACCOUNTADMIN:`,
              `-- Add Snowflake egress CIDRs to the existing ingress rule:`,
              `ALTER NETWORK RULE ${ingressRule}`,
              `  SET VALUE_LIST = ('<your_existing_ips>', '${egressCidrs.join("', '")}');`,
            ] : [
              `-- Could not determine ingress rule. Ensure the network policy on ${instance_name} includes these CIDRs:`,
              ...egressCidrs.map(c => `--   ${c}`),
            ]
          })
        }

        checks.push({ name: "Ingress (Snowflake → PG)", ok: true, message: "Snowflake egress IPs found in ingress rule" })

        return Response.json({ passed: true, checks, host, commands: [] })
      }

      case "list_databases": {
        // Connect to the 'postgres' db on the given instance_id and list databases
        const result = await querySnowflake(
          `CALL PGSYNC_DB.PROCEDURES.PG_QUERY(${params.instance_id}, 'SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN (''snowflake_monitoring'') ORDER BY datname')`
        )
        const parsed = result[0]?.PG_QUERY
        if (parsed && parsed.status === "SUCCESS") {
          return Response.json({ databases: parsed.rows.map((r: any) => r.datname) })
        }
        return Response.json({ databases: [], error: parsed?.error || "Could not list databases" })
      }

      case "add_instance": {
        const { name, host, port, database, databases, service_user, password } = params
        const secretName = `PGSYNC_DB.METADATA.PG_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`

        // Create a secret for this instance
        await querySnowflake(
          `CREATE OR REPLACE SECRET ${secretName} TYPE = PASSWORD USERNAME = '${service_user || "snowflake_admin"}' PASSWORD = '${password}'`
        )

        // Insert one row per selected database (or just one if single database provided)
        const dbList: string[] = databases && databases.length > 0 ? databases : [database || "postgres"]
        for (const db of dbList) {
          await querySnowflake(
            `INSERT INTO PGSYNC_DB.METADATA.SYNC_INSTANCES 
             (INSTANCE_NAME, PG_HOST, PG_PORT, PG_DATABASE, PG_SERVICE_USER, SECRET_NAME, NETWORK_RULE_NAME, EAI_NAME)
             SELECT '${name}', '${host}', ${port || 5432}, '${db}', '${service_user || "snowflake_admin"}', '${secretName}', '${STANDARD_NETWORK_RULE}', '${STANDARD_EAI}'
             WHERE NOT EXISTS (
               SELECT 1 FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE PG_HOST = '${host}' AND PG_DATABASE = '${db}'
             )`
          )
        }

        // Update EAI to include the new secret, then rebuild procedures
        await rebuildEai()
        await querySnowflake(`ALTER GIT REPOSITORY PGSYNC_DB.PROCEDURES.PGSYNC_REPO FETCH`)
        await rebuildProcedures()

        return Response.json({ success: true, message: `Instance added with ${dbList.length} database(s). Procedures rebuilt.` })
      }

      case "test_connection": {
        try {
          const result = await querySnowflake(
            `CALL PGSYNC_DB.PROCEDURES.PG_QUERY(${params.instance_id}, 'SELECT current_database() as db, current_user as usr')`
          )
          const parsed = result[0]?.PG_QUERY
          if (parsed && parsed.status === "SUCCESS") {
            return Response.json({ status: "connected", db: parsed.rows?.[0]?.db, user: parsed.rows?.[0]?.usr })
          } else if (parsed?.error) {
            const err = parsed.error
            if (err.includes("Cannot connect") || err.includes("timed out")) {
              return Response.json({ status: "network_error", error: "Cannot reach Postgres. Check that the POSTGRES_INGRESS network policy includes Snowflake's egress IPs and the instance is READY." })
            } else if (err.includes("password") || err.includes("authentication") || err.includes("28P01")) {
              return Response.json({ status: "auth_error", error: "Authentication failed. Check username and password." })
            }
            return Response.json({ status: "error", error: err })
          }
          return Response.json({ status: "error", error: "Unexpected response" })
        } catch (e: any) {
          return Response.json({ status: "error", error: e.message })
        }
      }

      case "remove_instance": {
        const deps = await querySnowflake(
          `SELECT COUNT(*) AS CNT FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (deps[0]?.CNT > 0) {
          return Response.json({ error: `Instance has ${deps[0].CNT} active sync configs. Remove them first.` }, { status: 400 })
        }
        const inst = await querySnowflake(
          `SELECT SECRET_NAME FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        await querySnowflake(`DELETE FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`)
        // Only drop secret if no other instances use it
        if (inst[0]?.SECRET_NAME && inst[0].SECRET_NAME !== "PGSYNC_DB.METADATA.PG_SECRET") {
          const others = await querySnowflake(
            `SELECT COUNT(*) AS CNT FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE SECRET_NAME = '${inst[0].SECRET_NAME}'`
          )
          if (others[0]?.CNT === 0) {
            try { await querySnowflake(`DROP SECRET IF EXISTS ${inst[0].SECRET_NAME}`) } catch {}
          }
        }
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
    return Response.json({ error: e instanceof Error ? e.message : "Admin operation failed" }, { status: 500 })
  }
}
