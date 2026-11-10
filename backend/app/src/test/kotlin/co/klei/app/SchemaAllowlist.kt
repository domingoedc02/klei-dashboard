package co.klei.app

import org.springframework.jdbc.core.JdbcTemplate

/** AD-5: the only column shapes a table may have. Shared by `BackendIT` and `LeakSuiteIT`. */
object SchemaAllowlist {
    fun violations(jdbc: JdbcTemplate): List<String> =
        jdbc.queryForList(
            "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name <> 'flyway_schema_history'",
        ).filterNot {
            val c = it["column_name"] as String
            val t = it["data_type"] as String
            when {
                c == "id" || c.endsWith("_id") -> t == "uuid"
                c == "seq" || c == "version" || c == "generation" || c == "kek_version" -> t in setOf("integer", "bigint", "smallint")
                c.endsWith("_ct") || c.endsWith("_bidx") || c == "wrapped_dek" -> t == "bytea"
                else -> false
            }
        }.map { "${it["table_name"]}.${it["column_name"]} (${it["data_type"]})" }
}
