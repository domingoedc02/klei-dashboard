package co.klei.crypto

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.postgresql.ds.PGSimpleDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import javax.sql.DataSource
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DekStoreTest {
    companion object {
        // Shared with KeyRotationTest in the same JVM: no stop here, Testcontainers removes the container at exit.
        private val pg = PostgreSQLContainer("postgres:18.6").also { it.start() }
        private val ddl: String = generateSequence(Path.of("").toAbsolutePath()) { it.parent }
            .map { it.resolve("backend/app/src/main/resources/db/migration/V2__data_key.sql") }.plus(
                generateSequence(Path.of("").toAbsolutePath()) { it.parent }.map { it.resolve("app/src/main/resources/db/migration/V2__data_key.sql") },
            ).first(Files::exists).let(Files::readString)


        private var n = 0
        fun freshSchema(): DataSource {
            val name = "s${n++}"
            PGSimpleDataSource().apply { setUrl(pg.jdbcUrl); user = pg.username; password = pg.password }.connection.use {
                it.createStatement().use { st -> st.execute("create schema $name") }
            }
            return PGSimpleDataSource().apply { setUrl(pg.jdbcUrl); user = pg.username; password = pg.password; currentSchema = name }.also { ds ->
                ds.connection.use { it.createStatement().use { st -> st.execute(ddl) } }
            }
        }
    }

    private lateinit var db: DataSource

    @BeforeEach fun setUp() { db = freshSchema() }

    private fun rows() = db.connection.use { c -> c.createStatement().use { st -> st.executeQuery("select count(*) from data_key").use { it.next(); it.getInt(1) } } }

    @Test fun `eight concurrent first starts leave exactly one data key and share it`() {
        val env = testEnv()
        val gate = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        val col = ColumnRef("t", "c")
        val row = UUID.randomUUID()
        val blobs = (1..8).map {
            pool.submit(Callable { val m = CryptoModule(env, db); gate.await(); m.selfTest(); m.crypto.encrypt(byteArrayOf(it.toByte()), col, row) })
        }
        gate.countDown()
        val out = blobs.map { it.get() }
        pool.shutdown()
        assertEquals(1, rows())
        val reader = CryptoModule(env, db).crypto
        out.forEachIndexed { i, b -> assertContentEquals(byteArrayOf((i + 1).toByte()), reader.decrypt(b, col, row)) }
    }

    @Test fun `the stored dek is wrapped and its kek version is recorded`() {
        CryptoModule(testEnv(active = 2, keks = 2), db).selfTest()
        db.connection.use { c ->
            c.createStatement().use { st ->
                st.executeQuery("select wrapped_dek, kek_version, generation from data_key").use {
                    it.next()
                    assertEquals(12 + 32 + 16, it.getBytes(1).size)
                    assertEquals(2, it.getInt(2))
                    assertEquals(1, it.getInt(3))
                }
            }
        }
    }

    @Test fun `a row that needs a kek that is not configured names its version`() {
        CryptoModule(testEnv(), db).selfTest()
        val e = assertFailsWith<KeyRingException> { CryptoModule(testEnv(active = 2, keks = 2) - "KLEI_KEK_1", db).selfTest() }
        assertEquals("missing_kek", e.code)
        assertEquals(listOf("KLEI_KEK_1"), e.variables)
    }

    @Test fun `a newer generation is found by a node that cached only the old one`() {
        val env = testEnv()
        val reader = CryptoModule(env, db)
        reader.selfTest()
        val ring = KeyRing.parse(env)
        val newId = UUID.randomUUID()
        db.connection.use { c ->
            c.prepareStatement("insert into data_key (id, generation, wrapped_dek, kek_version) values (?, 2, ?, 1)").use {
                it.setObject(1, newId); it.setBytes(2, Wrap.wrap(ring.keks.getValue(1), ByteArray(32) { 9 }, newId.toString())); it.executeUpdate()
            }
        }
        val col = ColumnRef("t", "c")
        val row = UUID.randomUUID()
        val blob = CryptoService(object : Deks {
            val dek = Dek(newId, ByteArray(32) { 9 })
            override fun active() = dek
            override fun byId(id: UUID) = dek
        }).encrypt("new".toByteArray(), col, row)
        assertContentEquals("new".toByteArray(), reader.crypto.decrypt(blob, col, row))
        val stranger = CryptoService(FixedDeks()).encrypt("x".toByteArray(), col, row)
        assertFailsWith<CryptoException> { reader.crypto.decrypt(stranger, col, row) }
    }

    @Test fun `a wrapped dek copied to another row fails to unwrap`() {
        val ring = KeyRing.parse(testEnv())
        val wrapped = Wrap.wrap(ring.keks.getValue(1), ByteArray(32), UUID.randomUUID().toString())
        assertFailsWith<CryptoException> { Wrap.unwrap(ring.keks.getValue(1), wrapped, UUID.randomUUID().toString()) }
    }
}
