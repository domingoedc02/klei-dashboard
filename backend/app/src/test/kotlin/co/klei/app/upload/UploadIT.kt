package co.klei.app.upload

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.crypto.ObjectCipher
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Story 4.1: upload batch and photo API, encrypted storage, rejections, retries, ownership, delete, tamper, sweep. */
@Testcontainers
@Import(RecordingMailConfig::class, UploadIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class UploadIT {
    @TestConfiguration class Config { @Bean @Primary fun fakeStore() = FakeStore() }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @Autowired lateinit var store: FakeStore
    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var sweep: ObjectSweepJob
    @Autowired lateinit var vault: ObjectVault
    @Autowired lateinit var cipher: ObjectCipher
    @Value("\${klei.s3.bucket}") lateinit var bucket: String
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", api)
    private fun token(email: String, pw: String): String { val c = client(); return field(c.exchange(c.signIn(email, pw)).body, "accessToken")!! }
    private fun admin() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)

    private class Person(val id: UUID, val token: String)

    private fun person(role: String = DefaultRoles.STAFF): Person {
        val email = "up-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Una Upload", email, "Stafer-pass-1", rid, UserStatus.ACTIVE, true).id }!!
        return Person(id, token(email, "Stafer-pass-1"))
    }

    private fun open(p: Person) = UploadClient.call("POST", "$api/api/v1/uploads", p.token).also { assertEquals(200, it.status, it.text) }.id()
    private fun add(p: Person, batch: String, bytes: ByteArray, key: String = UUID.randomUUID().toString(), name: String = "gown.jpg", mime: String = "image/jpeg") =
        UploadClient.photo(api, p.token, batch, name, bytes, key, mime)

    @Test fun `only the upload permission opens a batch, and opening twice returns the same one`() {
        assertEquals(401, UploadClient.call("POST", "$api/api/v1/uploads", null).status)
        assertEquals(403, UploadClient.call("POST", "$api/api/v1/uploads", person(DefaultRoles.VIEWER).token).status)
        val p = person()
        val first = UploadClient.call("POST", "$api/api/v1/uploads", p.token)
        assertTrue(first.text.contains(""""phase":"empty""""), first.text)
        assertEquals(first.id(), open(p))
        assertEquals(1, jdbc.queryForObject("select count(*) from upload_batch where user_id = ?", Int::class.java, p.id))
    }

    @Test fun `a JPEG is stored as two encrypted UUID-keyed objects and read back`() {
        val p = person(); val batch = open(p)
        val before = store.objects.keys.toSet()
        val jpeg = Images.jpeg(comment = "EXIF-SENTINEL-zq77")
        val r = add(p, batch, jpeg, name = "bride-name-zq78.jpg")
        assertEquals(201, r.status, r.text)
        assertFalse(r.text.contains("zq78"), "filename echoed")
        val added = (store.objects.keys - before)
        assertEquals(2, added.size)
        for (k in added) {
            val body = store.objects[k]!!
            assertEquals(1 + 12 + 64 * 1024 + 16, body.size)
            assertFalse(String(body, Charsets.ISO_8859_1).contains("zq7"))
        }
        val thumb = UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${r.id()}?size=thumb", p.token)
        assertEquals(200, thumb.status)
        assertEquals("image/jpeg", thumb.header("Content-Type"))
        assertEquals("nosniff", thumb.header("X-Content-Type-Options"))
        assertTrue(thumb.header("Cache-Control")!!.contains("no-store"))
        assertTrue(thumb.body[0] == 0xFF.toByte() && thumb.body[1] == 0xD8.toByte())
        assertFalse(String(thumb.body, Charsets.ISO_8859_1).contains("zq77"), "metadata kept in thumbnail")
        val full = UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${r.id()}?size=full", p.token)
        assertContentEquals(jpeg, full.body)
        assertEquals("image/jpeg", full.header("Content-Type"))
        val cur = UploadClient.call("GET", "$api/api/v1/uploads/current", p.token)
        assertTrue(cur.text.contains(r.id()) && cur.text.contains(""""rejected":0"""), cur.text)
        assertFalse(cur.text.contains("zq78") || cur.text.contains("image/jpeg"))
        assertEquals(400, UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${r.id()}?size=huge", p.token).status)
    }

    @Test fun `PNG and WebP are accepted, a thumbnail is always a JPEG`() {
        val p = person(); val batch = open(p)
        for ((bytes, mime) in listOf(Images.png() to "image/png", Images.WEBP to "image/webp")) {
            val r = add(p, batch, bytes, mime = mime)
            assertEquals(201, r.status, r.text)
            assertEquals(mime, UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${r.id()}?size=full", p.token).header("Content-Type"))
            assertEquals("image/jpeg", UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${r.id()}", p.token).header("Content-Type"))
        }
    }

    @Test fun `the same Idempotency-Key stores one photo, a missing key is refused`() {
        val p = person(); val batch = open(p)
        val before = store.objects.size
        val one = add(p, batch, Images.jpeg(), key = "retry-1")
        val two = add(p, batch, Images.jpeg(), key = "retry-1")
        assertEquals(201, one.status); assertEquals(201, two.status)
        assertEquals(one.id(), two.id())
        assertEquals(before + 2, store.objects.size)
        assertNotEquals(one.id(), add(p, batch, Images.jpeg(), key = "retry-2").id())
        assertEquals(400, UploadClient.photo(api, p.token, batch, "a.jpg", Images.jpeg(), null).status)
    }

    @Test fun `bad files are refused with a problem, never echo the name, store nothing and are counted`() {
        val p = person(); val batch = open(p)
        val before = store.objects.size
        val bad = mapOf(
            "text" to Triple("notes-zq90.txt", "just words".toByteArray(), 415),
            "gif claiming jpeg" to Triple("sneaky-zq91.jpg", "GIF89a....".toByteArray(), 415),
            "polyglot" to Triple("poly-zq92.jpg", Images.polyglot(), 415),
            "undecodable" to Triple("cut-zq93.jpg", Images.jpeg().copyOf(100), 415),
            "41 megapixels" to Triple("huge-zq94.png", Images.pngHeaderOnly(6500, 6500), 413),
            "over 25 MB" to Triple("big-zq95.jpg", ByteArray(25 * 1024 * 1024 + 1), 413),
        )
        for ((label, v) in bad) {
            val r = add(p, batch, v.second, name = v.first)
            assertEquals(v.third, r.status, "$label: ${r.text}")
            assertTrue(r.header("Content-Type")!!.contains("problem+json"), label)
            assertFalse(r.text.contains("zq9"), "$label echoed the filename: ${r.text}")
        }
        assertEquals(before, store.objects.size)
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id = ?", Int::class.java, UUID.fromString(batch)))
        assertTrue(UploadClient.call("GET", "$api/api/v1/uploads/current", p.token).text.contains(""""rejected":${bad.size}"""))
    }

    @Test fun `the 201st photo is refused`() {
        val p = person(); val batch = open(p)
        val tiny = Images.jpeg(8, 8)
        repeat(UploadLimits.MAX_PHOTOS) { assertEquals(201, add(p, batch, tiny).status) }
        val r = add(p, batch, tiny)
        assertEquals(413, r.status, r.text)
        assertTrue(r.text.contains("too_large"), r.text)
    }

    @Test fun `another user's batch and photos answer 404`() {
        val a = person(); val b = person()
        val batchA = open(a); open(b)
        val photo = add(a, batchA, Images.jpeg()).id()
        assertEquals(404, add(b, batchA, Images.jpeg()).status)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/uploads/$batchA/photos/$photo", b.token).status)
        assertEquals(404, UploadClient.call("DELETE", "$api/api/v1/uploads/$batchA/photos/$photo", b.token).status)
        assertEquals(200, UploadClient.call("GET", "$api/api/v1/uploads/$batchA/photos/$photo", a.token).status)
    }

    @Test fun `delete removes the row and both objects once, then answers 404`() {
        val p = person(); val batch = open(p)
        val before = store.objects.size
        val photo = add(p, batch, Images.jpeg()).id()
        assertEquals(before + 2, store.objects.size)
        assertEquals(204, UploadClient.call("DELETE", "$api/api/v1/uploads/$batch/photos/$photo", p.token).status)
        assertEquals(before, store.objects.size)
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where id = ?", Int::class.java, UUID.fromString(photo)))
        assertEquals(404, UploadClient.call("DELETE", "$api/api/v1/uploads/$batch/photos/$photo", p.token).status)
    }

    @Test fun `a swapped object fails with crypto_failure, not with data`() {
        val p = person(); val batch = open(p)
        val one = add(p, batch, Images.jpeg(), key = "swap-1").id()
        val two = add(p, batch, Images.png(), key = "swap-2").id()
        fun original(id: String) = jdbc.queryForObject("select original_object_id from photo where id = ?", UUID::class.java, UUID.fromString(id))!!
        val a = original(one); val b = original(two)
        val bodyA = store.objects[a]!!; val bodyB = store.objects[b]!!
        try {
            store.objects[a] = bodyB; store.objects[b] = bodyA
            val r = UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/$one?size=full", p.token)
            assertEquals(500, r.status)
            assertTrue(r.text.contains("crypto_failure"), r.text)
        } finally {
            store.objects[a] = bodyA; store.objects[b] = bodyB
        }
        assertEquals(200, UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/$one?size=full", p.token).status)
    }

    @Test fun `deleting a user discards their batch, photos and objects`() {
        val p = person(); val batch = open(p)
        val before = store.objects.size
        add(p, batch, Images.jpeg()); add(p, batch, Images.png())
        assertEquals(before + 4, store.objects.size)
        assertEquals(204, UploadClient.call("DELETE", "$api/api/v1/admin/users/${p.id}", admin()).status)
        assertEquals(before, store.objects.size)
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_batch where user_id = ?", Int::class.java, p.id))
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id = ?", Int::class.java, UUID.fromString(batch)))
    }

    @Test fun `the sweep removes only what is older than a day and has no owner`() {
        val now = Instant.now()
        val oldOrphan = UUID.randomUUID(); val youngOrphan = UUID.randomUUID()
        store.put(oldOrphan, byteArrayOf(1)); store.put(youngOrphan, byteArrayOf(2))
        store.modified[oldOrphan] = now.minus(Duration.ofHours(25)); store.modified[youngOrphan] = now.minus(Duration.ofHours(23))

        fun row(age: Duration): UUID {
            val k = vault.put(byteArrayOf(3))
            tx.executeWithoutResult { em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, now.minus(age))) }
            return k.id
        }
        val oldRow = row(Duration.ofHours(25)); val youngRow = row(Duration.ofHours(1))
        val p = person(); val kept = add(p, open(p), Images.jpeg()).id()
        val keptObject = jdbc.queryForObject("select original_object_id from photo where id = ?", UUID::class.java, UUID.fromString(kept))!!

        val res = sweep.sweep(now)
        assertEquals(1, res.objects); assertEquals(1, res.rows)
        assertFalse(store.objects.containsKey(oldOrphan)); assertTrue(store.objects.containsKey(youngOrphan))
        assertFalse(store.objects.containsKey(oldRow)); assertTrue(store.objects.containsKey(youngRow))
        assertEquals(0, jdbc.queryForObject("select count(*) from stored_object where id = ?", Int::class.java, oldRow))
        assertEquals(1, jdbc.queryForObject("select count(*) from stored_object where id = ?", Int::class.java, youngRow))
        assertTrue(store.objects.containsKey(keptObject), "an owned object must survive")
    }
}
