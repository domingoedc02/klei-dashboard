package co.klei.crypto

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Story 9.2: re-wrap moves every wrapped DEK to the active KEK, old data stays readable, and the old KEK can then go. */
class KeyRotationTest {
    private lateinit var db: DataSource
    private val old = testEnv(active = 1, keks = 1)
    private val both = testEnv(active = 2, keks = 2)
    private val onlyNew = both - "KLEI_KEK_1"

    @BeforeEach fun setUp() {
        db = DekStoreTest.freshSchema()
        db.connection.use { it.createStatement().use { st -> st.execute("create table stored_object (id uuid primary key, wrapped_dek bytea not null, kek_version integer not null)") } }
    }

    private fun putObject(kek: Int, ring: KeyRing): UUID {
        val id = UUID.randomUUID()
        db.connection.use { c ->
            c.prepareStatement("insert into stored_object (id, wrapped_dek, kek_version) values (?, ?, ?)").use {
                it.setObject(1, id); it.setBytes(2, Wrap.wrap(ring.keks.getValue(kek), ByteArray(32) { 7 }, id.toString())); it.setInt(3, kek); it.executeUpdate()
            }
        }
        return id
    }

    private fun rewrapAll(m: CryptoModule): Int {
        var moved = 0
        for (t in KeyRotation.Table.entries) while (true) {
            val n = db.connection.use { c -> c.autoCommit = false; m.rotation.rewrapBatch(c, t, 2).also { c.commit() } }
            if (n == 0) break
            moved += n
        }
        return moved
    }

    private fun counts(m: CryptoModule, t: KeyRotation.Table) = db.connection.use { m.rotation.status(it, t) }

    @Test fun `empty tables pass the boot check`() {
        val m = CryptoModule(onlyNew, db)
        db.connection.use { m.rotation.requireConfigured(it) }
    }

    @Test fun `a row that needs a KEK the process lacks stops the boot and names the variable`() {
        CryptoModule(old, db).selfTest()
        val e = assertFailsWith<KeyRingException> { db.connection.use { CryptoModule(onlyNew, db).rotation.requireConfigured(it) } }
        assertEquals("missing_kek", e.code)
        assertEquals(listOf("KLEI_KEK_1"), e.variables)
    }

    @Test fun `a restore with the wrong KEK value stops the boot, names the variable and leaves the rows untouched`() {
        CryptoModule(old, db).selfTest()
        val before = db.connection.use { c -> c.createStatement().use { st -> st.executeQuery("select wrapped_dek from data_key").use { rs -> rs.next(); rs.getBytes(1) } } }
        val wrong = old + ("KLEI_KEK_1" to testKey(9))
        val e = assertFailsWith<KeyRingException> { CryptoModule(wrong, db).selfTest() }
        assertEquals("wrong_kek", e.code)
        assertEquals(listOf("KLEI_KEK_1"), e.variables)
        assertEquals("wrong_kek: KLEI_KEK_1", e.message)
        val after = db.connection.use { c -> c.createStatement().use { st -> st.executeQuery("select wrapped_dek from data_key").use { rs -> rs.next(); rs.getBytes(1) } } }
        assertContentEquals(before, after)
    }

    @Test fun `re-wrap moves every row, the old KEK can then go and old data still reads`() {
        val first = CryptoModule(old, db)
        val col = ColumnRef("t", "c")
        val row = UUID.randomUUID()
        val blob = first.crypto.encrypt("hello".toByteArray(), col, row)
        val ring = KeyRing.parse(both)
        val objs = List(5) { putObject(1, ring) }

        val m = CryptoModule(both, db)
        assertEquals(mapOf(1 to 5L), counts(m, KeyRotation.Table.STORED_OBJECT))
        assertEquals(mapOf(1 to 1L), counts(m, KeyRotation.Table.DATA_KEY))
        assertEquals(6, rewrapAll(m))
        assertEquals(mapOf(2 to 5L), counts(m, KeyRotation.Table.STORED_OBJECT))
        assertEquals(mapOf(2 to 1L), counts(m, KeyRotation.Table.DATA_KEY))

        val last = CryptoModule(onlyNew, db)
        db.connection.use { last.rotation.requireConfigured(it) }
        assertContentEquals("hello".toByteArray(), last.crypto.decrypt(blob, col, row))
        val unwrapped = db.connection.use { c ->
            c.prepareStatement("select wrapped_dek from stored_object where id = ?").use {
                it.setObject(1, objs[0]); it.executeQuery().use { rs -> rs.next(); rs.getBytes(1) }
            }
        }
        assertContentEquals(ByteArray(32) { 7 }, Wrap.unwrap(KeyRing.parse(onlyNew).keks.getValue(2), unwrapped, objs[0].toString()))
    }

    @Test fun `a second run changes nothing`() {
        CryptoModule(old, db).selfTest()
        val m = CryptoModule(both, db)
        assertEquals(1, rewrapAll(m))
        assertEquals(0, rewrapAll(m))
    }
}
