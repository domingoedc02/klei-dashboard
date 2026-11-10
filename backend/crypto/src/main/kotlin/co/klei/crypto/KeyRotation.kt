package co.klei.crypto

import java.sql.Connection
import java.util.UUID

/** Re-wrap primitives on a raw JDBC connection (architecture §5.4). Never touches a `*_ct` column or an S3 object. */
class KeyRotation internal constructor(private val ring: KeyRing) {
    /** The two tables that hold a wrapped DEK. The enum is the allowlist: a table name never comes from outside. */
    enum class Table(internal val sql: String) { DATA_KEY("data_key"), STORED_OBJECT("stored_object") }

    val activeKek: Int get() = ring.activeKek
    val highestKek: Int get() = ring.keks.keys.max()
    val configured: List<Int> get() = ring.keks.keys.sorted()

    /** Boot check (architecture §5.4 step 4): a row that still needs a KEK this process does not hold stops the start and names the variable. */
    fun requireConfigured(c: Connection) {
        val missing = Table.entries.flatMap { status(c, it).keys }.distinct().filter { it !in ring.keks }.sorted()
        if (missing.isNotEmpty()) throw KeyRingException("missing_kek", missing.map { "KLEI_KEK_$it" })
    }

    /** Row counts per `kek_version`. */
    fun status(c: Connection, t: Table): Map<Int, Long> = c.createStatement().use { st ->
        st.executeQuery("select kek_version, count(*) from ${t.sql} group by kek_version").use { rs ->
            buildMap { while (rs.next()) put(rs.getInt(1), rs.getLong(2)) }
        }
    }

    /** Re-wraps up to [limit] rows whose `kek_version` is below the active KEK. Returns the count; 0 means done. Idempotent. */
    fun rewrapBatch(c: Connection, t: Table, limit: Int = 500): Int {
        val active = ring.keks.getValue(ring.activeKek)
        val rows = c.prepareStatement("select id, wrapped_dek, kek_version from ${t.sql} where kek_version < ? order by id limit ? for update").use { ps ->
            ps.setInt(1, ring.activeKek); ps.setInt(2, limit)
            ps.executeQuery().use { rs -> buildList { while (rs.next()) add(Triple(rs.getObject(1, UUID::class.java), rs.getBytes(2), rs.getInt(3))) } }
        }
        c.prepareStatement("update ${t.sql} set wrapped_dek = ?, kek_version = ? where id = ?").use { up ->
            for ((id, wrapped, version) in rows) {
                val dek = Wrap.unwrap(ring.keks[version] ?: throw CryptoException("missing_kek"), wrapped, id.toString())
                up.setBytes(1, Wrap.wrap(active, dek, id.toString())); up.setInt(2, ring.activeKek); up.setObject(3, id)
                up.addBatch()
            }
            up.executeBatch()
        }
        return rows.size
    }
}
