package co.klei.crypto

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Tenant DEKs from `data_key`, unwrapped once and cached. Reads lazily so a Flyway migration that runs before
 * `data_key` exists never trips it. The first key is created with `INSERT … ON CONFLICT DO NOTHING`, then every
 * node re-reads, so concurrent starts end with exactly one row.
 */
internal class DekStore(private val db: DataSource, private val ring: KeyRing) : Deks {
    private val cache = ConcurrentHashMap<UUID, Dek>()
    @Volatile private var active: Dek? = null

    override fun active(): Dek = active ?: synchronized(this) { active ?: load(createIfEmpty = true).also { active = it } }

    override fun byId(id: UUID): Dek = cache[id] ?: synchronized(this) {
        cache[id] ?: run { load(createIfEmpty = false); cache[id] } ?: throw CryptoException("unknown_dek")
    }

    /** Reads every row; returns the highest generation. */
    private fun load(createIfEmpty: Boolean): Dek {
        var rows = readAll()
        if (rows.isEmpty() && createIfEmpty) {
            insertFirst()
            rows = readAll()
        }
        val top = rows.maxByOrNull { it.first } ?: throw CryptoException("no_data_key")
        rows.forEach { (_, dek) -> cache[dek.id] = dek }
        return top.second
    }

    private fun readAll(): List<Pair<Int, Dek>> = db.connection.use { c ->
        c.createStatement().use { st ->
            st.executeQuery("select id, generation, wrapped_dek, kek_version from data_key").use { rs ->
                buildList {
                    while (rs.next()) {
                        val id = rs.getObject(1, UUID::class.java)
                        val v = rs.getInt(4)
                        val kek = ring.keks[v] ?: throw KeyRingException("missing_kek", listOf("KLEI_KEK_$v"))
                        val dek = try {
                            Wrap.unwrap(kek, rs.getBytes(3), id.toString())
                        } catch (e: CryptoException) {
                            throw KeyRingException("wrong_kek", listOf("KLEI_KEK_$v"))
                        }
                        add(rs.getInt(2) to Dek(id, dek))
                    }
                }
            }
        }
    }

    private fun insertFirst() {
        val id = UUID.randomUUID()
        val wrapped = Wrap.wrap(ring.keks.getValue(ring.activeKek), Jca.random(32), id.toString())
        db.connection.use { c ->
            c.prepareStatement("insert into data_key (id, generation, wrapped_dek, kek_version) values (?, 1, ?, ?) on conflict do nothing").use {
                it.setObject(1, id)
                it.setBytes(2, wrapped)
                it.setInt(3, ring.activeKek)
                it.executeUpdate()
            }
        }
    }
}
