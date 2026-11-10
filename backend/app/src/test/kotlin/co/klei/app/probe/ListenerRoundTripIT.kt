package co.klei.app.probe

import co.klei.app.TestSupport
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.CryptoException
import co.klei.crypto.Envelope
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.time.Instant
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFails
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Story 1.3 proof: the Hibernate interceptor encrypts on write and decrypts on read against real PostgreSQL. */
@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ListenerRoundTripIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("spring.flyway.locations") { "classpath:db/migration,classpath:db/probe" }
            r.add("klei.auth-port") { authPort }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var bidx: BlindIndex
    @PersistenceContext lateinit var em: EntityManager

    private val seen = Instant.parse("2026-03-01T10:15:30.123Z")
    private val ct = listOf("name_ct", "email_ct", "seen_at_ct", "flag_ct", "phase_ct", "attrs_ct")

    private fun probe(id: UUID = UUID.randomUUID()) =
        CryptoProbe(id, "Sentinel-Name-Ámbar", "Sentinel@Example.com", seen, true, Phase.IN_PROGRESS, Attrs(1, listOf("sentinel-a", "b")))
            .also { p -> tx.executeWithoutResult { em.persist(p) } }.id

    private fun raw(id: UUID): Map<String, Any?> = jdbc.queryForMap("select * from crypto_probe where id = ?", id)
    private fun bytes(row: Map<String, Any?>, c: String) = row[c] as ByteArray?
    private fun load(id: UUID): CryptoProbe = tx.execute { em.find(CryptoProbe::class.java, id)!!.also { it.name; it.attrs } }!!
    private fun causes(e: Throwable) = generateSequence(e) { it.cause }

    @Test fun `insert stores envelopes only and a clean session reads the plaintext back`() {
        val id = probe()
        val row = raw(id)
        for (c in ct) assertTrue(Envelope.looksValid(bytes(row, c)!!), c)
        assertEquals(32, bytes(row, "email_bidx")!!.size)
        assertFalse(row.values.filterIsInstance<ByteArray>().any { String(it, Charsets.ISO_8859_1).contains("entinel") })

        val p = load(id)
        assertEquals("Sentinel-Name-Ámbar", p.name)
        assertEquals("Sentinel@Example.com", p.email)
        assertEquals(seen, p.seenAt)
        assertTrue(p.flag)
        assertEquals(Phase.IN_PROGRESS, p.phase)
        assertEquals(Attrs(1, listOf("sentinel-a", "b")), p.attrs)
    }

    @Test fun `changing one field rewrites only that column`() {
        val id = probe()
        val before = raw(id)
        tx.executeWithoutResult { em.find(CryptoProbe::class.java, id)!!.name = "Sentinel-Other" }
        val after = raw(id)
        assertNotEquals(bytes(before, "name_ct")!!.toList(), bytes(after, "name_ct")!!.toList())
        for (c in ct - "name_ct" + "email_bidx") assertContentEquals(bytes(before, c), bytes(after, c), c)
        assertEquals((before["version"] as Long) + 1, after["version"])
        assertEquals("Sentinel-Other", load(id).name)
    }

    @Test fun `saving an unchanged entity writes nothing`() {
        val id = probe()
        val before = raw(id)
        tx.executeWithoutResult { em.find(CryptoProbe::class.java, id)!!.apply { name = name; email = email; attrs = attrs?.copy() } }
        val after = raw(id)
        for (c in ct + "email_bidx") assertContentEquals(bytes(before, c), bytes(after, c), c)
        assertEquals(before["version"], after["version"])
    }

    @Test fun `blind index follows the email and finds the row`() {
        val id = probe()
        tx.executeWithoutResult { em.find(CryptoProbe::class.java, id)!!.email = "  New@Example.COM " }
        assertContentEquals(bidx.of(BidxDomain.CLIENT_EMAIL, "new@example.com"), bytes(raw(id), "email_bidx"))
        val found = tx.execute {
            em.createQuery("select p.id from CryptoProbe p where p.emailBidx = :b", UUID::class.java)
                .setParameter("b", bidx.of(BidxDomain.CLIENT_EMAIL, "NEW@example.com")).resultList
        }
        assertEquals(listOf(id), found)
    }

    @Test fun `a null value stores null and clears its index`() {
        val id = probe()
        tx.executeWithoutResult { em.find(CryptoProbe::class.java, id)!!.email = null }
        assertNull(bytes(raw(id), "email_ct"))
        assertNull(bytes(raw(id), "email_bidx"))
        assertNull(load(id).email)
    }

    @Test fun `a blob moved to another row or column fails to open`() {
        val a = probe()
        val b = probe()
        jdbc.update("update crypto_probe set name_ct = (select name_ct from crypto_probe where id = ?) where id = ?", a, b)
        assertTrue(causes(assertFails { load(b) }).any { it is CryptoException })

        val c = probe()
        jdbc.update("update crypto_probe set email_ct = name_ct where id = ?", c)
        assertTrue(causes(assertFails { load(c) }).any { it is CryptoException })
    }

    @Test fun `a blob moved to another table with the same id and column name fails to open`() {
        val id = probe()
        tx.executeWithoutResult { em.persist(CryptoProbe2(id, "x")) }
        jdbc.update("update crypto_probe_2 set name_ct = (select name_ct from crypto_probe where id = ?) where id = ?", id, id)
        assertTrue(causes(assertFails { tx.execute { em.find(CryptoProbe2::class.java, id)!!.name } }).any { it is CryptoException })
    }

    @Test fun `every ct value in every table is an envelope`() {
        probe()
        val cols = jdbc.queryForList(
            "select table_name || '.' || column_name from information_schema.columns where table_schema = 'public' and column_name like '%\\_ct'",
            String::class.java,
        )
        assertTrue(cols.size >= 7)
        for (tc in cols) {
            val (t, c) = tc!!.split('.')
            for (v in jdbc.queryForList("select $c from $t where $c is not null", ByteArray::class.java)) assertTrue(Envelope.looksValid(v!!), tc)
        }
    }
}
