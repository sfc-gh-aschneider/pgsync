import { querySnowflake, querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

const STANDARD_NETWORK_RULE = "PGSYNC_DB.METADATA.PGSYNC_NETWORK_RULE"
const STANDARD_EAI = "PGSYNC_PG_EAI"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    switch (action) {
      case "check_network": {
        const inst = await querySnowflake(
          `SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (!inst.length) return Response.json({ error: "Instance not found" }, { status: 404 })
        const instance = inst[0]
        const host = instance.PG_HOST
        const port = instance.PG_PORT || 5432
        const hostPort = `${host}:${port}`

        // Check if the standardized network rule exists
        let hasNetworkRule = false
        let ruleIncludesHost = false
        try {
          const rules = await querySnowflake(`DESCRIBE NETWORK RULE ${STANDARD_NETWORK_RULE}`)
          hasNetworkRule = true
          // Check if the VALUE_LIST includes this host
          const valueRow = rules.find((r: any) => r.property === "value_list" || r.name === "value_list")
          if (valueRow) {
            const valueList = (valueRow.value || valueRow.property_value || "").toLowerCase()
            ruleIncludesHost = valueList.includes(host.toLowerCase())
          } else {
            // Try SHOW NETWORK RULES approach
            const showRules = await querySnowflake(
              `SELECT GET_DDL('NETWORK_RULE', '${STANDARD_NETWORK_RULE}') AS DDL`
            )
            if (showRules.length > 0) {
              const ddl = (showRules[0].DDL || "").toLowerCase()
              ruleIncludesHost = ddl.includes(host.toLowerCase())
            }
          }
        } catch {
          hasNetworkRule = false
        }

        // Check if EAI exists
        let hasEai = false
        try {
          await querySnowflake(`DESCRIBE INTEGRATION ${STANDARD_EAI}`)
          hasEai = true
        } catch {
          hasEai = false
        }

        let message = ""
        if (!hasNetworkRule) message = "Network rule not found"
        else if (!ruleIncludesHost) message = `Host not in network rule`
        else if (!hasEai) message = "EAI not found"
        else message = "All configured"

        return Response.json({
          status: {
            instance_id: params.instance_id,
            has_network_rule: hasNetworkRule,
            has_eai: hasEai,
            rule_includes_host: ruleIncludesHost,
            host_port: hostPort,
            message,
          },
        })
      }

      case "apply_network_rule": {
        const inst = await querySnowflake(
          `SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (!inst.length) return Response.json({ error: "Instance not found" }, { status: 404 })
        const instance = inst[0]
        const host = instance.PG_HOST
        const port = instance.PG_PORT || 5432
        const hostPort = `${host}:${port}`

        // Get all registered instance hosts to build a complete VALUE_LIST
        const allInstances = await querySnowflake(
          `SELECT PG_HOST, PG_PORT FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE`
        )
        const allHosts = allInstances.map(
          (i: any) => `'${i.PG_HOST}:${i.PG_PORT || 5432}'`
        )
        // Ensure current host is included
        if (!allHosts.some((h: string) => h.includes(host))) {
          allHosts.push(`'${hostPort}'`)
        }
        const valueList = allHosts.join(", ")

        // Create or replace the network rule with all hosts
        await querySnowflake(
          `CREATE OR REPLACE NETWORK RULE ${STANDARD_NETWORK_RULE}
           TYPE = 'HOST_PORT'
           MODE = 'EGRESS'
           VALUE_LIST = (${valueList})`
        )

        // Check if EAI exists, if not create it
        let eaiExists = false
        try {
          await querySnowflake(`DESCRIBE INTEGRATION ${STANDARD_EAI}`)
          eaiExists = true
        } catch {
          eaiExists = false
        }

        if (!eaiExists) {
          // Need ACCOUNTADMIN for this
          await querySnowflake(`USE ROLE ACCOUNTADMIN`)
          await querySnowflake(
            `CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS ${STANDARD_EAI}
             ALLOWED_NETWORK_RULES = (${STANDARD_NETWORK_RULE})
             ALLOWED_AUTHENTICATION_SECRETS = (PGSYNC_DB.METADATA.PG_SECRET)
             ENABLED = TRUE`
          )
          await querySnowflake(`GRANT USAGE ON INTEGRATION ${STANDARD_EAI} TO ROLE SYSADMIN`)
          await querySnowflake(`USE ROLE SYSADMIN`)
        } else {
          // Update EAI to reference the (possibly new) network rule
          await querySnowflake(`USE ROLE ACCOUNTADMIN`)
          await querySnowflake(
            `ALTER EXTERNAL ACCESS INTEGRATION ${STANDARD_EAI} SET
             ALLOWED_NETWORK_RULES = (${STANDARD_NETWORK_RULE})`
          )
          await querySnowflake(`USE ROLE SYSADMIN`)
        }

        // Update instance record with network rule/EAI names
        await querySnowflake(
          `UPDATE PGSYNC_DB.METADATA.SYNC_INSTANCES 
           SET NETWORK_RULE_NAME = '${STANDARD_NETWORK_RULE}',
               EAI_NAME = '${STANDARD_EAI}',
               UPDATED_AT = CURRENT_TIMESTAMP()
           WHERE INSTANCE_ID = ${params.instance_id}`
        )

        return Response.json({ success: true, message: `Network rule updated with ${allHosts.length} host(s)` })
      }

      case "add_instance": {
        const { name, host, port, database, service_user, secret_name } = params
        await querySnowflake(
          `INSERT INTO PGSYNC_DB.METADATA.SYNC_INSTANCES 
           (INSTANCE_NAME, PG_HOST, PG_PORT, PG_DATABASE, PG_SERVICE_USER, SECRET_NAME, NETWORK_RULE_NAME, EAI_NAME)
           VALUES ('${name}', '${host}', ${port || 5432}, '${database || "postgres"}', '${service_user || "bridge_svc"}', '${secret_name}', '${STANDARD_NETWORK_RULE}', '${STANDARD_EAI}')`
        )

        // Auto-add this host to the network rule
        const allInstances = await querySnowflake(
          `SELECT PG_HOST, PG_PORT FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE ENABLED = TRUE`
        )
        const allHosts = allInstances.map(
          (i: any) => `'${i.PG_HOST}:${i.PG_PORT || 5432}'`
        )
        const valueList = allHosts.join(", ")

        try {
          await querySnowflake(
            `CREATE OR REPLACE NETWORK RULE ${STANDARD_NETWORK_RULE}
             TYPE = 'HOST_PORT'
             MODE = 'EGRESS'
             VALUE_LIST = (${valueList})`
          )
          // Update EAI
          await querySnowflake(`USE ROLE ACCOUNTADMIN`)
          await querySnowflake(
            `ALTER EXTERNAL ACCESS INTEGRATION ${STANDARD_EAI} SET
             ALLOWED_NETWORK_RULES = (${STANDARD_NETWORK_RULE})`
          )
          await querySnowflake(`USE ROLE SYSADMIN`)
        } catch (e) {
          console.warn("[admin] Could not auto-update network rule:", e)
          // Not fatal - instance is still added
        }

        return Response.json({ success: true })
      }

      case "remove_instance": {
        // Check for dependent configs
        const deps = await querySnowflake(
          `SELECT COUNT(*) AS CNT FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE INSTANCE_ID = ${params.instance_id}`
        )
        if (deps[0]?.CNT > 0) {
          return Response.json({ error: `Instance has ${deps[0].CNT} active sync configs. Remove them first.` }, { status: 400 })
        }
        await querySnowflake(
          `DELETE FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = ${params.instance_id}`
        )
        return Response.json({ success: true })
      }

      case "toggle_instance": {
        await querySnowflake(
          `UPDATE PGSYNC_DB.METADATA.SYNC_INSTANCES 
           SET ENABLED = ${params.enabled}, UPDATED_AT = CURRENT_TIMESTAMP()
           WHERE INSTANCE_ID = ${params.instance_id}`
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
