package co.klei.app.leak

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxyUtil
import ch.qos.logback.core.read.ListAppender
import co.klei.app.SchemaAllowlist
import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.ai.StubProvider
import co.klei.app.auth.CredentialService
import co.klei.app.identity.AppUser
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.crypto.CryptoException
import co.klei.app.upload.Images
import co.klei.app.upload.UploadClient
import co.klei.crypto.Envelope
import co.klei.crypto.CryptoModule
import co.klei.crypto.ObjectCipher
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.postgresql.PGConnection
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.Base64
import java.util.UUID
import co.klei.crypto.Totp
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * NFR-1 proof (architecture §5.7): writes Sentinels through app code, then looks for them in every place a copy could land.
 * Searches plain, URL-encoded, hex and base64 forms (all three base64 alignments) in raw bytes.
 */
@Testcontainers
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class LeakSuiteIT {
    class Box(image: String) : GenericContainer<Box>(image)

    companion object {
        const val BUCKET = "leak-test"
        const val S3_KEY = "leakaccess"
        const val S3_SECRET = "leaksecret0123456789"

        // Attached before the context starts, so startup logging is covered too.
        val logs = ListAppender<ILoggingEvent>().apply { start() }
        init { (LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger).addAppender(logs) }

        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")

        @Container @JvmStatic val seaweed = Box("chrislusf/seaweedfs:4.52")
            .withCommand("server", "-dir=/data", "-s3", "-ip.bind=0.0.0.0", "-volume.max=0")
            .withEnv("AWS_ACCESS_KEY_ID", S3_KEY).withEnv("AWS_SECRET_ACCESS_KEY", S3_SECRET)
            .withExposedPorts(8333, 9333)
            .waitingFor(Wait.forHttp("/cluster/status").forPort(9333).withStartupTimeout(Duration.ofSeconds(120)))

        @Container @JvmStatic val mailpit = Box("axllent/mailpit:v1.33.0")
            .withExposedPorts(1025, 8025)
            .waitingFor(Wait.forHttp("/api/v1/info").forPort(8025))

        private val authPort = ServerSocket(0).use { it.localPort }
        /** Answers with sentinel model ids and a text that must never reach a client, log or table. */
        val provider = StubProvider(listOf(SentinelCatalog.aiModelA, SentinelCatalog.aiModelB), SentinelCatalog.aiProviderText)
        @AfterAll @JvmStatic fun stopProvider() = provider.close()
        private val s3Endpoint get() = "http://${seaweed.host}:${seaweed.getMappedPort(8333)}"

        private fun s3Client() = S3Client.builder()
            .endpointOverride(URI.create(s3Endpoint)).region(Region.US_EAST_1)
            .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(S3_KEY, S3_SECRET)))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
            .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
            .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
            .build()

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.ai.dev-mode") { "true" }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            r.add("spring.mail.host") { mailpit.host }
            r.add("spring.mail.port") { mailpit.getMappedPort(1025) }
            TestSupport.keys(r)
            r.add("KLEI_KEK_2") { TestSupport.key(2) }
            r.add("KLEI_KEK_ACTIVE") { "2" }
            TestSupport.bootstrap(r)
            r.add("klei.s3.endpoint") { s3Endpoint }
            r.add("klei.s3.access-key") { S3_KEY }
            r.add("klei.s3.secret-key") { S3_SECRET }
            r.add("klei.s3.bucket") { BUCKET }
            // The S3 port opens after the master reports healthy.
            s3Client().use { c ->
                val end = System.nanoTime() + Duration.ofSeconds(60).toNanos()
                while (true) {
                    try { c.listBuckets(); break } catch (e: Exception) { if (System.nanoTime() > end) throw e; Thread.sleep(1000) }
                }
            }
        }

        @Volatile private var objectId: UUID? = null
        /** Admin token, batch id and the two Photo ids the seed uploaded. */
        @Volatile private var uploaded: Triple<String, String, List<String>>? = null
    }

    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var dataSource: javax.sql.DataSource
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var credentials: CredentialService
    @Autowired lateinit var cipher: ObjectCipher
    @Autowired lateinit var usageRecorder: co.klei.app.ai.AiUsageRecorder
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var mailSender: org.springframework.mail.javamail.JavaMailSender
    @Autowired lateinit var ctx: org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
    @PersistenceContext lateinit var em: EntityManager

    private fun seed(): Unit = synchronized(Companion) {
        if (objectId != null) return
        val staff = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        with(SentinelCatalog) {
            users.create(name1, email1, password1, staff, UserStatus.ACTIVE, verified = true)
            users.create(name2, email2, password2, staff, UserStatus.INVITED, verified = false)
            audit.record("leak_test", detail = detail, actorName = actor, ip = ip)
            signInThroughAuthWeb(email1, password1, password2)
            inviteAndVerify()
            forgotAndReset()
            staffEdits()
            roleEdits()
            aiEdits()
            uploadEdits()
            profileEdits()
            signatureEdits()
        prefsEdits()
            inquiryEdits()
            assistantEdits()
            replyEdits()
            awayEdits()
            twoFactorEdits()
            keyEdits()
            val id = UUID.randomUUID()
            val sealed = cipher.encrypt(objectBody.toByteArray(), BUCKET, id)
            s3Client().use { it.putObject({ b -> b.bucket(BUCKET).key(id.toString()) }, RequestBody.fromBytes(sealed.body)) }
            jdbc.update("insert into stored_object(id, wrapped_dek, kek_version) values (?, ?, ?)", id, sealed.wrappedDek, sealed.kekVersion)
            objectId = id
        }
    }

    /** Real sign-in with Sentinel credentials, two wrong passwords first; the code and both tokens become Sentinels too. */
    private fun signInThroughAuthWeb(email: String, password: String, wrong: String) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        c.authorize()
        repeat(2) { check(c.login(email, wrong).status == 401) }
        val code = checkNotNull(c.login(email, password).code()) { "sign-in refused" }
        val t = c.exchange(code)
        check(t.status == 200) { t.body }
        SentinelCatalog.captured += listOf(code, AuthWebClient.field(t.body, "accessToken")!!, AuthWebClient.field(t.body, "refreshToken")!!)
        check(c.api("GET", "/api/v1/me", bearer = AuthWebClient.field(t.body, "accessToken")).status == 200)
    }

    /** Admin invites a User with Sentinel name and email; A2 and A3 are completed through the web pages with mail read from Mailpit. */
    private fun inviteAndVerify() = with(SentinelCatalog) {
        val viewer = roles.roles().first { it.name == DefaultRoles.VIEWER }.id
        credentials.invite(name3, email3, viewer, users.find(TestSupport.ADMIN_EMAIL)!!.id)
        val invite = mailTo(email3, "/invite#")
        val inviteToken = Regex("/invite#([A-Za-z0-9_-]{43})").find(invite)!!.groupValues[1]
        mailed += inviteToken

        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        c.get("/invite")
        check(c.submit("/invite/open", mapOf("token" to inviteToken)).status == 200)
        val a3 = c.submit("/invite", mapOf("token" to inviteToken, "name" to name4, "password" to password3, "confirm" to password3))
        check(a3.status == 200 && a3.body.contains("name=\"code\"")) { a3.body }

        val verify = mailTo(email3, "verification code")
        val code = Regex("code is (\\d{6})").find(verify)!!.groupValues[1]
        mailed += listOf(code, Regex("/verify#([A-Za-z0-9_-]{43})").find(verify)!!.groupValues[1])
        // One wrong code first, so the attempt counter is written too.
        check(c.submit("/verify", mapOf("code" to if (code == "000000") "111111" else "000000")).status == 400)
        check(c.submit("/verify", mapOf("code" to code)).body.contains("Email verified."))
        val s = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        check(s.exchange(s.signIn(email3, password3)).status == 200)
    }

    /** The invited User forgets the password: A4 sends the link, A5 sets password4. Both pages echo only the address; the mail holds only the link. */
    private fun forgotAndReset() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        c.get("/forgot")
        check(c.submit("/forgot", mapOf("email" to email3)).status == 200)
        check(c.submit("/forgot", mapOf("email" to "nobody-$email3")).status == 200)
        val mail = mailTo(email3, "/reset#")
        val token = Regex("/reset#([A-Za-z0-9_-]{43})").find(mail)!!.groupValues[1]
        mailed += token
        val r = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        r.get("/reset")
        check(r.submit("/reset/open", mapOf("token" to token)).status == 200)
        check(r.submit("/reset", mapOf("token" to token, "password" to password4, "confirm" to password4)).body.contains("Password updated."))
        val s = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        check(s.exchange(s.signIn(email3, password4)).status == 200)
    }

    /** An Admin invites, edits (name, email), re-sends and deletes a User through the staff endpoints; every Sentinel they carry must leave no plaintext, deleted rows included. */
    private fun staffEdits() = with(SentinelCatalog) {
        val web = "http://127.0.0.1:${ctx.webServer!!.port}"
        val c = AuthWebClient("http://127.0.0.1:$authPort", web)
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val viewer = roles.roles().first { it.name == DefaultRoles.VIEWER }.id
        val made = c.api("POST", "/api/v1/admin/users", """{"name":"$name5","email":"$email4","roleId":"$viewer"}""", admin)
        check(made.status == 201) { made.body }
        val id = AuthWebClient.field(made.body, "id")!!
        mailed += Regex("/invite#([A-Za-z0-9_-]{43})").find(mailTo(email4, "/invite#"))!!.groupValues[1]

        val version = Regex(""""id":"$id"[^}]*"version":(\d+)""").find(c.api("GET", "/api/v1/admin/users", bearer = admin).body)!!.groupValues[1]
        val edit = c.api("PATCH", "/api/v1/admin/users/$id", """{"name":"$name6","email":"$email5"}""", admin, mapOf("If-Match" to version))
        check(edit.status == 200) { edit.body }
        check(c.api("POST", "/api/v1/admin/users/$id/resend", null, admin).status == 204)
        val end = System.nanoTime() + Duration.ofSeconds(30).toNanos()
        var mails = emptyList<String>()
        while (System.nanoTime() < end && mails.size < 2) { mails = mailIds("to:\"$email5\"").map { mailpitGet("/api/v1/message/$it") }; Thread.sleep(250) }
        check(mails.size == 2) { "expected the edit and the resend to mail $email5" }
        mailed += mails.flatMap { m -> Regex("/invite#([A-Za-z0-9_-]{43})").findAll(m).map { it.groupValues[1] }.toList() }

        check(c.api("DELETE", "/api/v1/admin/users/$id", null, admin).status == 204)
    }

    /** Staff gains and loses a Permission through the API: the audit detail names it, the epoch bump stales the token. */
    private fun roleEdits() {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        fun admin() = AuthWebClient.field(c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)).body, "accessToken")!!
        val staff = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        fun put(perms: String) {
            val t = admin()
            val v = Regex(""""id":"$staff"[^}]*"version":(\d+)""").find(c.api("GET", "/api/v1/admin/roles", bearer = t).body)!!.groupValues[1]
            val r = c.api("PUT", "/api/v1/admin/roles", """{"roleId":"$staff","permissions":[$perms]}""", t, mapOf("If-Match" to v))
            check(r.status == 200) { r.body }
        }
        val base = """"PERM_VIEW_GALLERY","PERM_UPLOAD_IMAGES","PERM_EDIT_GOWN","PERM_REPLY","PERM_CLOSE_INQUIRY""""
        put("$base,\"PERM_DELETE_GOWN\"")
        put(base)
    }

    /**
     * Story 9.2: a row still wrapped by KEK 1 is re-wrapped to KEK 2 through the Admin API. The status answer and every log line hold no key text and no wrapped DEK;
     * the planted row is removed afterwards because it has no object in the bucket.
     */
    private fun keyEdits() {
        val old = CryptoModule(
            mapOf("KLEI_KEK_1" to TestSupport.key(1), "KLEI_KEK_ACTIVE" to "1", "KLEI_BIDX_KEY" to TestSupport.key(50), "KLEI_JWT_KEY" to TestSupport.key(100)), dataSource,
        )
        val id = UUID.randomUUID()
        val sealed = old.objects.encrypt("legacy".toByteArray(), BUCKET, id)
        check(sealed.kekVersion == 1)
        jdbc.update("insert into stored_object(id, wrapped_dek, kek_version) values (?, ?, ?)", id, sealed.wrappedDek, sealed.kekVersion)
        SentinelCatalog.captured += listOf(Base64.getEncoder().encodeToString(sealed.wrappedDek), sealed.wrappedDek.joinToString("") { "%02x".format(it) })

        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = AuthWebClient.field(c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)).body, "accessToken")!!
        val before = c.api("GET", "/api/v1/admin/keys/status", bearer = t)
        check(before.status == 200 && before.body.contains("\"1\":1")) { "status: ${before.status} ${before.body}" }
        check(c.api("POST", "/api/v1/admin/keys/rewrap", null, t).status in 200..202)
        var after = before
        val end = System.nanoTime() + Duration.ofSeconds(30).toNanos()
        while (System.nanoTime() < end) {
            after = c.api("GET", "/api/v1/admin/keys/status", bearer = t)
            if (!after.body.contains("\"running\"")) break
            Thread.sleep(100)
        }
        check(after.body.contains("\"done\"") && !after.body.contains("\"1\":")) { "re-wrap did not finish: ${after.body}" }
        check(SentinelCatalog.keyText.none { it in before.body + after.body } && SentinelCatalog.captured.none { it in before.body + after.body }) { "the key status holds key text" }
        jdbc.update("delete from stored_object where id = ?", id)
    }

    /** An Admin saves a provider with Sentinel address, key, organization and models, runs Test connection, then fails one with the provider's own error text. */
    private fun aiEdits() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val url = provider.baseUrl("/$aiUrlPath")
        val form = """{"preset":"custom","baseUrl":"$url","apiKey":"$aiKey","embeddingBaseUrl":"${provider.baseUrl("/$aiEmbedPath").replace("127.0.0.1", "localhost")}","embeddingApiKey":"$aiEmbedKey","organization":"$aiOrg","chatModel":"$aiChat","visionModel":"$aiVision","visionModelAdv":"$aiVisionAdv","sensitivity":4,"tone":"editorial","advanced":true,"embeddingModel":"$aiEmbed","temperature":0.7,"maxTokens":1024}"""
        val saved = c.api("PUT", "/api/v1/admin/ai", form, admin, mapOf("If-Match" to "0"))
        check(saved.status == 200) { saved.body }
        val ok = c.api("POST", "/api/v1/admin/ai/test", null, admin)
        check(ok.status == 200 && ok.body.contains("\"connected\"")) { ok.body }
        provider.mode = StubProvider.Mode.UNAUTHORIZED
        val bad = c.api("POST", "/api/v1/admin/ai/test", null, admin)
        check(bad.status == 200 && bad.body.contains("Unauthorized")) { bad.body }
        provider.mode = StubProvider.Mode.OK
        taxonomyEdits(c, admin)
        usageEdits(c, admin)
    }

    /** Story 6.1: a Staff member renames themself, uploads a photo carrying a JPEG comment and changes the password; none of it may stay readable anywhere. */
    private fun profileEdits() = with(SentinelCatalog) {
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val email = "profiler-${UUID.randomUUID()}@example.test"
        users.create("Profiler Test", email, "Profiler-pass-1", roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, verified = true)
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(email, "Profiler-pass-1"))
        val token = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(token, AuthWebClient.field(t.body, "refreshToken")!!)
        val json = mapOf("Content-Type" to "application/json")
        val version = Regex("\"version\":(\\d+)").find(UploadClient.call("GET", "$api/api/v1/me/profile", token).text)!!.groupValues[1]
        val named = UploadClient.call("PATCH", "$api/api/v1/me/profile", token, "{\"name\":\"$profileName\"}".toByteArray(), json + ("If-Match" to version))
        check(named.status == 200 && named.text.contains(profileName)) { "rename failed: ${named.status} ${named.text}" }
        val boundary = "klei" + UUID.randomUUID().toString().replace("-", "")
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$uploadName\"\r\nContent-Type: image/jpeg\r\n\r\n"
        val body = head.toByteArray() + Images.jpeg(comment = avatarExif) + "\r\n--$boundary--\r\n".toByteArray()
        val put = UploadClient.call("PUT", "$api/api/v1/me/avatar", token, body, mapOf("Content-Type" to "multipart/form-data; boundary=$boundary"))
        check(put.status == 200) { "avatar failed: ${put.status} ${put.text}" }
        check(UploadClient.call("GET", "$api/api/v1/me/avatar", token).status == 200)
        val changed = UploadClient.call("POST", "$api/api/v1/me/password", token, "{\"current\":\"Profiler-pass-1\",\"new\":\"$password5\"}".toByteArray(), json)
        check(changed.status == 204) { "password change failed: ${changed.status} ${changed.text}" }
        check(c.exchange(c.signIn(email, password5)).status == 200)
    }

    /** Story 6.2: an Admin sets the Studio and a Staff member saves a signature; none of those lines may stay readable anywhere. */
    private fun signatureEdits() = with(SentinelCatalog) {
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val version = Regex("\"version\":(\\d+)").find(c.api("GET", "/api/v1/admin/workspace", null, admin).body)!!.groupValues[1]
        val studio = c.api("PUT", "/api/v1/admin/workspace", "{\"studioName\":\"$studioName\",\"studioAddress\":\"$studioAddress\\nSecond line\"}", admin, mapOf("If-Match" to version))
        check(studio.status == 200 && studio.body.contains(studioName)) { "studio failed: ${studio.status} ${studio.body}" }
        val email = "signer-${UUID.randomUUID()}@example.test"
        users.create("Signer Test", email, "Signer-pass-1", roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, verified = true)
        val st = c.exchange(c.signIn(email, "Signer-pass-1"))
        val token = AuthWebClient.field(st.body, "accessToken")!!
        captured += listOf(token, AuthWebClient.field(st.body, "refreshToken")!!)
        val sig = c.api("PUT", "/api/v1/me/signature", "{\"enabled\":true,\"signoff\":\"$sigSignoff\",\"name\":\"$sigName\",\"title\":\"$sigTitle\",\"phone\":\"$sigPhone\"}", token, mapOf("If-Match" to "0"))
        check(sig.status == 200 && sig.body.contains(sigName)) { "signature failed: ${sig.status} ${sig.body}" }
        check(c.api("GET", "/api/v1/me/signature", null, token).body.contains(studioName))
    }

    /** Story 6.3: a User saves a timezone; the preferences stay an envelope in `prefs_ct`. */
    private fun prefsEdits() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val body = "{\"timezone\":\"$prefsZone\",\"dateFormat\":\"DD/MM/YYYY\",\"startPage\":\"gallery\",\"enterToSend\":true,\"newInquiry\":false,\"aiFinished\":true,\"teamActivity\":false,\"emailNewInquiry\":true,\"emailAiFinished\":false,\"emailTeamActivity\":true,\"digest\":\"daily\"}"
        val saved = c.api("PUT", "/api/v1/me/preferences", body, admin, mapOf("If-Match" to "0"))
        check(saved.status == 200 && saved.body.contains(prefsZone)) { "preferences failed: ${saved.status} ${saved.body}" }
    }

    /** Story 7.1: a Client writes in; name, address, subject and body must stay inside envelopes, in the list as much as at rest. */
    private fun inquiryEdits() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val body = "{\"clientName\":\"$clientName\",\"clientEmail\":\"$clientEmail\",\"subject\":\"$inquirySubject\",\"body\":\"$inquiryBody\"}"
        val made = c.api("POST", "/api/v1/inquiries", body, admin, mapOf("Idempotency-Key" to "leak-inq-1"))
        check(made.status == 201) { "inquiry failed: ${made.status} ${made.body}" }
        val list = c.api("POST", "/api/v1/inquiries/query", "{}", admin)
        check(list.status == 200 && list.body.contains(inquirySubject)) { "inquiry list failed: ${list.status} ${list.body}" }
        // Story 7.4: a Client edit and a status change leave nothing readable either.
        val id = Regex("\"id\":\"([0-9a-f-]{36})\"").find(made.body)!!.groupValues[1]
        val clientId = Regex("\"client\":\\{\"id\":\"([0-9a-f-]{36})\"").find(c.api("GET", "/api/v1/inquiries/$id", null, admin).body)!!.groupValues[1]
        val cv = Regex("\"version\":(\\d+)").find(c.api("GET", "/api/v1/clients/$clientId", null, admin).body)!!.groupValues[1]
        val edit = c.api("PATCH", "/api/v1/clients/$clientId", "{\"phone\":\"$clientPhone\",\"city\":\"$clientCity\",\"weddingDate\":\"$weddingDate\",\"source\":\"$clientSource\",\"note\":\"$clientNote\"}", admin, mapOf("If-Match" to cv))
        check(edit.status == 200 && edit.body.contains(clientNote)) { "client edit failed: ${edit.status} ${edit.body}" }
        val iv = Regex("\"version\":(\\d+)").find(c.api("GET", "/api/v1/inquiries/$id", null, admin).body)!!.groupValues[1]
        val closed = c.api("PATCH", "/api/v1/inquiries/$id", "{\"status\":\"closed\"}", admin, mapOf("If-Match" to iv))
        check(closed.status == 200) { "close failed: ${closed.status} ${closed.body}" }
        val found = c.api("POST", "/api/v1/search", "{\"q\":\"$inquirySubject\"}", admin)
        check(found.status == 200 && found.body.contains(id)) { "inquiry search failed: ${found.status} ${found.body}" }
    }

    /** Story 8.3: a Sentinel question and answer through the assistant; the context sent to the provider never carries the Client email. */
    private fun assistantEdits() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val mark = provider.seen.size
        provider.chatAnswer = { chatAnswer }
        val sent = c.api("POST", "/api/v1/assistant/chat/messages", "{\"text\":\"summarize new inquiries $chatQuestion\"}", admin)
        provider.chatAnswer = StubProvider.DEFAULT_ANSWER
        check(sent.status == 201 && sent.body.contains(chatAnswer)) { "assistant failed: ${sent.status} ${sent.body}" }
        val asked = provider.seen.drop(mark).filter { it.contains("/chat/completions") }
        check(asked.isNotEmpty() && asked.none { it.contains(clientEmail) }) { "assistant context missing or carried the Client email" }
        val back = c.api("GET", "/api/v1/assistant/chat", null, admin)
        check(back.status == 200 && back.body.contains(chatQuestion)) { "assistant history failed: ${back.status} ${back.body}" }
    }

    /**
     * Story 7.3: a draft, a file and a reply with Sentinel text (the mail to the Client carries the text and the file by design), a second
     * Inquiry whose draft stays unsent, and a reply sent while the mail server is unreachable, then retried.
     */
    private fun replyEdits() = with(SentinelCatalog) {
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        fun inquiry(key: String): String {
            val made = c.api("POST", "/api/v1/inquiries", "{\"clientName\":\"$clientName\",\"clientEmail\":\"$clientEmail\",\"subject\":\"$inquirySubject\",\"body\":\"$inquiryBody\"}", admin, mapOf("Idempotency-Key" to key))
            check(made.status == 201) { "inquiry failed: ${made.status} ${made.body}" }
            return Regex("\"id\":\"([0-9a-f-]{36})\"").find(made.body)!!.groupValues[1]
        }
        fun draft(id: String, text: String) {
            val r = c.api("PUT", "/api/v1/inquiries/$id/draft", "{\"body\":\"<div>$text</div>\"}", admin)
            check(r.status == 200) { "draft failed: ${r.status} ${r.body}" }
        }
        val first = inquiry("leak-inq-reply-1")
        draft(first, draftText)
        val file = UploadClient.attachment(api, admin, first, attachName, attachBody.toByteArray(), "leak-att-1")
        check(file.status == 201) { "attachment failed: ${file.status} ${file.text}" }
        val sent = c.api("POST", "/api/v1/inquiries/$first/reply", "{\"body\":\"<div>$replyText</div>\"}", admin, mapOf("Idempotency-Key" to "leak-reply-1"))
        check(sent.status == 201 && sent.body.contains("\"mailState\":\"sent\"")) { "reply failed: ${sent.status} ${sent.body}" }

        draft(inquiry("leak-inq-reply-2"), draftText)

        val down = inquiry("leak-inq-reply-3")
        val sender = mailSender as org.springframework.mail.javamail.JavaMailSenderImpl
        val port = sender.port
        sender.port = 1
        val failed = try {
            c.api("POST", "/api/v1/inquiries/$down/reply", "{\"body\":\"<div>$replyText</div>\"}", admin, mapOf("Idempotency-Key" to "leak-reply-3"))
        } finally { sender.port = port }
        check(failed.status == 201 && failed.body.contains("\"mailState\":\"failed\"")) { "failing reply: ${failed.status} ${failed.body}" }
        val again = c.api("POST", "/api/v1/messages/${Regex("\"id\":\"([0-9a-f-]{36})\"").find(failed.body)!!.groupValues[1]}/retry", null, admin)
        check(again.status == 200 && again.body.contains("\"mailState\":\"sent\"")) { "retry: ${again.status} ${again.body}" }
    }

    /**
     * Story 11.12: the Admin saves a message that is always on (every day of the week), then a client writes in. One away mail goes out;
     * a second inquiry from the same client sends none.
     */
    private fun awayEdits() = with(SentinelCatalog) {
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val days = "\"mon\",\"tue\",\"wed\",\"thu\",\"fri\",\"sat\",\"sun\""
        val saved = c.api("PUT", "/api/v1/admin/away", "{\"enabled\":true,\"message\":\"$awayMessage\",\"schedule\":{\"mode\":\"weekly\",\"days\":[$days]}}", admin, mapOf("If-Match" to "0"))
        check(saved.status == 200 && saved.body.contains(awayMessage)) { "away failed: ${saved.status} ${saved.body}" }
        repeat(2) { n ->
            val made = c.api("POST", "/api/v1/inquiries", "{\"clientName\":\"$awayClientName\",\"clientEmail\":\"$awayClientEmail\",\"subject\":\"$inquirySubject\",\"body\":\"$inquiryBody\"}", admin, mapOf("Idempotency-Key" to "leak-away-$n"))
            check(made.status == 201) { "away inquiry failed: ${made.status} ${made.body}" }
        }
    }

    /**
     * Story 11.14: a User enrols (the secret, the otpauth URI and the recovery codes are shown once), signs in with a code and with a recovery code,
     * fails once, and turns it off. None of those random values may stay readable in any table, log, mail or error body.
     */
    private fun twoFactorEdits() = with(SentinelCatalog) {
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val email = "twofa-${UUID.randomUUID()}@example.test"
        val pw = "Twofa-pass-1"
        users.create("Twofa Test", email, pw, roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, verified = true)
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(email, pw))
        val token = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(token, AuthWebClient.field(t.body, "refreshToken")!!)
        val start = c.api("POST", "/api/v1/me/2fa/start", null, token)
        check(start.status == 200) { "2fa start failed: ${start.status}" }
        val secret = AuthWebClient.field(start.body, "secret")!!
        captured += listOf(secret, AuthWebClient.field(start.body, "uri")!!)
        val step = Totp.stepAt(System.currentTimeMillis() / 1000)
        val bad = c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"000000"}""", token)
        check(bad.status == 422 && secret !in bad.body) { "wrong confirm: ${bad.status}" }
        val ok = c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"${Totp.code(secret, step)}"}""", token)
        check(ok.status == 200) { "2fa confirm failed: ${ok.status}" }
        val recovery = Regex("\"([A-Z2-7]{5}-[A-Z2-7]{5})\"").findAll(ok.body).map { it.groupValues[1] }.toList()
        check(recovery.size == 8)
        captured += recovery + recovery.map { it.replace("-", "") }

        c.authorize()
        check(c.login(email, pw).code() == null)
        check(c.submit("/login/code", mapOf("code" to "000000")).status == 401)
        check(c.submit("/login/code", mapOf("code" to Totp.code(secret, step + 1))).code() != null)
        c.authorize()
        c.login(email, pw)
        check(c.submit("/login/code", mapOf("code" to recovery[0], "recovery" to "1")).code() != null)

        val off = c.api("POST", "/api/v1/me/2fa/disable", """{"password":"$pw","code":"${recovery[1]}"}""", token)
        check(off.status == 204) { "2fa disable failed: ${off.status}" }
    }

    /** Two real uploads through the API with a Sentinel file name and a Sentinel JPEG comment, then one refused file whose name must not be echoed or logged. */
    private fun uploadEdits() = with(SentinelCatalog) {
        val c = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
        val t = c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD))
        val admin = AuthWebClient.field(t.body, "accessToken")!!
        captured += listOf(admin, AuthWebClient.field(t.body, "refreshToken")!!)
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        val batch = UploadClient.call("POST", "$api/api/v1/uploads", admin).also { check(it.status == 200) { it.text } }.id()
        val ids = listOf(
            UploadClient.photo(api, admin, batch, uploadName, Images.jpeg(comment = exifComment), "leak-1"),
            UploadClient.photo(api, admin, batch, "second-$uploadName", Images.png(), "leak-2", "image/png"),
        ).map { check(it.status == 201) { it.text }; it.id() }
        val refused = UploadClient.photo(api, admin, batch, "refused-$uploadName", "plain text $exifComment".toByteArray(), "leak-3", "text/plain")
        check(refused.status == 415 && !refused.text.contains(uploadName)) { refused.text }
        uploaded = Triple(admin, batch, ids)
        groupEdits(api, admin, batch)
        saveEdits(api)
    }

    /** A second Staff member saves a grouped batch as a Gown (the Sentinel name and description move to `gown`), then discards another; no object may stay behind. */
    private fun saveEdits(api: String) {
        val email = "saver-${UUID.randomUUID()}@example.test"
        users.create("Saver Test", email, "Saver-pass-1", roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, verified = true)
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        val t = c.exchange(c.signIn(email, "Saver-pass-1"))
        val token = AuthWebClient.field(t.body, "accessToken")!!
        SentinelCatalog.captured += listOf(token, AuthWebClient.field(t.body, "refreshToken")!!)
        val batch = UploadClient.call("POST", "$api/api/v1/uploads", token).also { check(it.status == 200) { it.text } }.id()
        listOf("leak-4" to Images.jpeg(comment = SentinelCatalog.exifComment), "leak-5" to Images.png()).forEach { (key, bytes) ->
            val r = UploadClient.photo(api, token, batch, SentinelCatalog.uploadName, bytes, key, if (key == "leak-5") "image/png" else "image/jpeg")
            check(r.status == 201) { r.text }
        }
        groupEdits(api, token, batch)
        val saved = UploadClient.call("POST", "$api/api/v1/uploads/$batch/save", token)
        check(saved.status == 200 && saved.text.contains("\"saved\":1")) { "save failed: ${saved.status} ${saved.text}" }
        gownEdits(api, token)
        commitEdits(api, token)
        val next = UploadClient.call("POST", "$api/api/v1/uploads", token).also { check(it.status == 200) { it.text } }.id()
        check(UploadClient.photo(api, token, next, SentinelCatalog.uploadName, Images.jpeg(), "leak-6").status == 201)
        check(UploadClient.call("DELETE", "$api/api/v1/uploads/$next", token).status == 204) { "discard failed" }
    }

    /**
     * Story 11.6: Rewrite asks the provider about one group and answers the new words; Commit then carries a Sentinel name and description in one body.
     * Neither may reach the provider, `ai_usage` (the scan covers it), the log or an audit detail, and the Rewrite answer is stored only after Commit.
     */
    private fun commitEdits(api: String, token: String) = with(SentinelCatalog) {
        val json = mapOf("Content-Type" to "application/json")
        val batch = UploadClient.call("POST", "$api/api/v1/uploads", token).also { check(it.status == 200) { it.text } }.id()
        listOf("leak-7" to Images.jpeg(comment = exifComment), "leak-8" to Images.png()).forEach { (key, bytes) ->
            check(UploadClient.photo(api, token, batch, uploadName, bytes, key, if (key == "leak-8") "image/png" else "image/jpeg").status == 201)
        }
        groupEdits(api, token, batch)
        val seen = provider.seen.size
        val status = UploadClient.call("GET", "$api/api/v1/uploads/$batch", token).text
        val gid = Regex(""""groups":\[\{"id":"([^"]+)"""").find(status)!!.groupValues[1]
        val version = Regex(""""version":(\d+)""").find(status)!!.groupValues[1]
        val photos = Regex(""""photoIds":\[([^\]]*)\]""").find(status)!!.groupValues[1]
        check(photos.contains(',')) { "expected one group of two photos: $status" }
        provider.chatAnswer = { """{"name":"x","attributes":{},"description":"$rewriteText"}""" }
        val rewritten = UploadClient.call("POST", "$api/api/v1/uploads/$batch/groups/$gid/rewrite", token, """{"photoIds":[$photos]}""".toByteArray(), json)
        provider.chatAnswer = StubProvider.DEFAULT_ANSWER
        check(rewritten.status == 200 && rewritten.text.contains(rewriteText)) { "rewrite failed: ${rewritten.status} ${rewritten.text}" }
        val body = """{"groups":[{"id":"$gid","version":$version,"name":"$commitName","description":"$commitDescription $rewriteText","photoIds":[$photos]}],"removed":[],"discarded":[]}"""
        val done = UploadClient.call("POST", "$api/api/v1/uploads/$batch/commit", token, body.toByteArray(), json)
        check(done.status == 200 && done.text.contains("\"saved\":1")) { "commit failed: ${done.status} ${done.text}" }
        check(provider.seen.drop(seen).none { it.contains(commitName) || it.contains(commitDescription) || it.contains(uploadName) || it.contains(exifComment) }) { "a commit word or upload content reached the provider" }
        check(provider.seen.drop(seen).count { it.contains("/chat/completions") } == 1) { "rewrite made more than one provider call" }
    }

    /** A saved Gown is retyped through the Gown PATCH; the new words reach only `gown.*_ct`, the term index (HMACs) and no log, audit detail or provider call. */
    private fun gownEdits(api: String, token: String) = with(SentinelCatalog) {
        val json = mapOf("Content-Type" to "application/json")
        val page = UploadClient.call("POST", "$api/api/v1/gowns/query", token, "{}".toByteArray(), json)
        val id = Regex(""""items":\[\{"id":"([^"]+)"""").find(page.text)?.groupValues?.get(1) ?: error("no saved gown: ${page.status} ${page.text}")
        val version = Regex(""""version":(\d+)""").find(UploadClient.call("GET", "$api/api/v1/gowns/$id", token).text)!!.groupValues[1]
        val edited = UploadClient.call(
            "PATCH", "$api/api/v1/gowns/$id", token, """{"name":"$gownEditName","description":"$gownEditDescription"}""".toByteArray(), json + ("If-Match" to version),
        )
        check(edited.status == 200 && edited.text.contains(gownEditName)) { "gown edit failed: ${edited.status} ${edited.text}" }
        check(provider.seen.none { it.contains(gownEditName) || it.contains(gownEditDescription) }) { "a gown edit reached the provider" }
        // Story 8.2: the searched word travels in a body, finds the Gown, and is stored only as an HMAC.
        val found = UploadClient.call("POST", "$api/api/v1/search", token, """{"q":"$gownEditName"}""".toByteArray(), json)
        check(found.status == 200 && found.text.contains(gownEditName)) { "gown search failed: ${found.status} ${found.text}" }
        gownExport(api, token, id)
    }

    /** FR-17: the manifest and the photo bytes are answered and forgotten; no archive, temp file or decrypted copy is left in the temp directory. */
    private fun gownExport(api: String, token: String, id: String) {
        val tmp = java.io.File(System.getProperty("java.io.tmpdir"))
        val before = tmp.walkTopDown().filter { it.isFile }.map { it.path }.toSet()
        val manifest = UploadClient.call("POST", "$api/api/v1/gowns/export", token, """{"ids":["$id"]}""".toByteArray(), mapOf("Content-Type" to "application/json"))
        check(manifest.status == 200 && manifest.text.contains("\"photos\"")) { "export failed: ${manifest.status} ${manifest.text}" }
        val photo = Regex(""""photos":\[\{"id":"([^"]+)"""").find(manifest.text)?.groupValues?.get(1) ?: error("export lists no photo: ${manifest.text}")
        check(UploadClient.call("GET", "$api/api/v1/gowns/$id/photos/$photo?size=full", token).status == 200) { "export photo read failed" }
        val made = tmp.walkTopDown().filter { it.isFile && it.path !in before }.toList()
        check(made.none { it.name.endsWith(".zip") || it.inputStream().use { s -> s.readNBytes(3).contentEquals(byteArrayOf(-1, -40, -1)) } }) { "export left a zip or image bytes behind: $made" }
    }

    /** Grouping reads the thumbnails, calls the stub provider and stores vectors and groups; none of it may surface the file name or the comment. */
    private fun groupEdits(api: String, admin: String, batch: String) = with(SentinelCatalog) {
        provider.vectorOf = { floatArrayOf(vectorFloats[0], vectorFloats[1], vectorFloats[2]) }
        provider.chatAnswer = { """{"name":"$gownName","attributes":{"silhouette":["A-line"]},"description":"$gownDescription"}""" }
        val started = UploadClient.call("POST", "$api/api/v1/uploads/$batch/start", admin)
        check(started.status == 202) { started.text }
        val end = System.nanoTime() + Duration.ofSeconds(40).toNanos()
        var last = started
        while (!last.text.contains("\"phase\":\"review\"")) {
            check(System.nanoTime() < end && !last.text.contains("\"phase\":\"error\"")) { "grouping did not finish: ${last.text}" }
            Thread.sleep(100)
            last = UploadClient.call("GET", "$api/api/v1/uploads/$batch", admin)
        }
        check(!last.text.contains(uploadName) && !last.text.contains(exifComment)) { "group status echoed upload content" }
        provider.vectorOf = { floatArrayOf(0.25f, 0.5f, 0.75f) }
        provider.chatAnswer = StubProvider.DEFAULT_ANSWER
        check(provider.seen.count { it.contains("/embeddings") } >= 2) { "provider saw no embedding calls" }
        check(last.text.contains(gownName)) { "the group status lost the gown name" }
        check(provider.seen.none { it.contains(uploadName) || it.contains(exifComment) }) { "upload content reached the provider" }
        check(provider.seen.any { it.contains("/chat/completions") }) { "provider saw no describe call" }
        val gid = Regex(""""groups":\[\{"id":"([^"]+)"""").find(last.text)!!.groupValues[1]
        val version = Regex(""""version":(\d+)""").find(last.text)!!.groupValues[1]
        val edited = UploadClient.call(
            "PATCH", "$api/api/v1/uploads/$batch/groups/$gid", admin, """{"name":"$editedName","description":"$editedDescription"}""".toByteArray(),
            mapOf("Content-Type" to "application/json", "If-Match" to version),
        )
        check(edited.status == 200 && edited.text.contains(editedName)) { "review edit failed: ${edited.status}" }
        check(provider.seen.none { it.contains(editedName) || it.contains(editedDescription) }) { "a review edit reached the provider" }
    }

    /** One recorded call carries a Sentinel prompt and response; the usage list must not return either. */
    private fun usageEdits(c: AuthWebClient, admin: String) = with(SentinelCatalog) {
        usageRecorder.record(co.klei.core.ai.AiCall(co.klei.core.ai.AiPurpose.DESCRIBE, null), aiEmbed, 1024, co.klei.core.ai.AiOutcome.OK, 5, usagePrompt, usageResponse)
        val list = c.api("GET", "/api/v1/admin/ai/usage", null, admin)
        check(list.status == 200 && list.body.contains("describe")) { list.body }
        check(!list.body.contains(usagePrompt) && !list.body.contains(usageResponse)) { "usage list returned a prompt or response" }
    }

    /** An Admin adds one Taxonomy value and renames another to Sentinel text; the audit detail names only the type. */
    private fun taxonomyEdits(c: AuthWebClient, admin: String) = with(SentinelCatalog) {
        val added = c.api("PUT", "/api/v1/taxonomy", """{"op":"add","type":"fabric","value":"$taxAdded"}""", admin, mapOf("If-Match" to "0"))
        check(added.status == 200 && added.body.contains(taxAdded)) { added.body }
        val mikado = Regex(""""id":"([^"]+)","type":"fabric","value":"Mikado","version":(\d+)""").find(added.body)!!.groupValues
        val renamed = c.api("PUT", "/api/v1/taxonomy", """{"op":"rename","id":"${mikado[1]}","value":"$taxRenamed"}""", admin, mapOf("If-Match" to mikado[2]))
        check(renamed.status == 200 && renamed.body.contains(taxRenamed)) { renamed.body }
    }

    private fun mailpitGet(path: String): String =
        HttpClient.newHttpClient().send(
            HttpRequest.newBuilder(URI.create("http://${mailpit.host}:${mailpit.getMappedPort(8025)}$path")).build(),
            HttpResponse.BodyHandlers.ofString(),
        ).body()

    private fun mailIds(query: String): List<String> =
        Regex(""""ID":"([^"]+)"""").findAll(mailpitGet("/api/v1/search?query=" + URLEncoder.encode(query, Charsets.UTF_8))).map { it.groupValues[1] }.toList()

    /** Text of the first mail to [to] that contains [part]; mail goes out on a worker thread, so poll. */
    private fun mailTo(to: String, part: String): String {
        val end = System.nanoTime() + Duration.ofSeconds(30).toNanos()
        while (System.nanoTime() < end) {
            mailIds("to:\"$to\"").map { mailpitGet("/api/v1/message/$it") }.firstOrNull { part in it.replace("\\u0026", "&") }?.let { return it }
            Thread.sleep(250)
        }
        error("no mail to $to containing '$part'")
    }

    // ---- matcher -----------------------------------------------------------------------------------------------

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    /** Every spelling of [s] that a copy could take. Base64 is searched at all three byte alignments. */
    private fun forms(s: String): Map<String, String> {
        val b = s.toByteArray(Charsets.UTF_8)
        val m = linkedMapOf("plain" to s, "url" to URLEncoder.encode(s, Charsets.UTF_8), "hex" to hex(b), "HEX" to hex(b).uppercase())
        val skip = intArrayOf(0, 2, 3)
        for (k in 0..2) {
            val padded = ByteArray(k) + b
            m["b64+$k"] = Base64.getEncoder().withoutPadding().encodeToString(padded).drop(skip[k]).dropLast(2)
            m["b64url+$k"] = Base64.getUrlEncoder().withoutPadding().encodeToString(padded).drop(skip[k]).dropLast(2)
        }
        return m
    }

    private fun iso(b: ByteArray) = String(b, Charsets.ISO_8859_1)

    private fun leaks(sources: Map<String, String>, skip: Set<String> = emptySet()): List<String> =
        (SentinelCatalog.all - skip).flatMap { s -> forms(s).flatMap { (form, needle) -> sources.filterValues { needle in it }.keys.map { "$it holds $form of $s" } } }

    private fun assertNoLeaks(sources: Map<String, String>, skip: Set<String> = emptySet()) {
        val found = leaks(sources, skip)
        assertTrue(found.isEmpty(), "plaintext leaked:\n" + found.joinToString("\n"))
    }

    // ---- sources -----------------------------------------------------------------------------------------------

    private fun tables(): List<String> =
        jdbc.queryForList("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'", String::class.java).filterNotNull()

    private fun copy(table: String, binary: Boolean): ByteArray = jdbc.dataSource!!.connection.use { c ->
        val out = ByteArrayOutputStream()
        c.unwrap(PGConnection::class.java).copyAPI.copyOut("COPY \"$table\" TO STDOUT" + if (binary) " (FORMAT binary)" else "", out)
        out.toByteArray()
    }

    private fun dbSources(): Map<String, String> = buildMap {
        for (t in tables()) {
            put("COPY text $t", iso(copy(t, false)))
            put("COPY binary $t", iso(copy(t, true)))
            jdbc.queryForList("select * from \"$t\"").forEachIndexed { i, row ->
                row.forEach { (c, v) ->
                    if (v is ByteArray) {
                        put("bytea-as-text $t.$c#$i", iso(v))
                        put("bytea-as-hex $t.$c#$i", hex(v))
                    }
                }
            }
        }
        val dump = pg.execInContainer("pg_dump", "-U", pg.username, pg.databaseName)
        assertEquals(0, dump.exitCode, dump.stderr)
        put("pg_dump", dump.stdout)
    }

    private fun objectSources(): Map<String, String> = buildMap {
        s3Client().use { c ->
            val keys = c.listObjectsV2 { it.bucket(BUCKET) }.contents().map { it.key() }
            assertTrue(keys.isNotEmpty())
            put("S3 keys", keys.joinToString("\n"))
            for (k in keys) {
                put("S3 body $k", iso(c.getObjectAsBytes { it.bucket(BUCKET).key(k) }.asByteArray()))
                put("S3 metadata $k", c.headObject { it.bucket(BUCKET).key(k) }.toString())
            }
        }
    }

    /** Every mail Mailpit holds, headers and body, as raw source and as the parsed JSON. */
    private fun mailSource(): String {
        val ids = Regex(""""ID":"([^"]+)"""").findAll(mailpitGet("/api/v1/messages?limit=500")).map { it.groupValues[1] }.toList()
        assertTrue(ids.isNotEmpty(), "Mailpit holds no mail, so the mail check proves nothing")
        return (listOf(mailpitGet("/api/v1/messages?limit=500")) + ids.flatMap { listOf(mailpitGet("/api/v1/message/$it"), mailpitGet("/api/v1/message/$it/raw")) }).joinToString("\n")
    }

    private fun logSource(): String = synchronized(logs.list) {
        logs.list.joinToString("\n") { e -> e.formattedMessage + (e.throwableProxy?.let { "\n" + ThrowableProxyUtil.asString(it) } ?: "") }
    }

    private fun dataDir(args: List<String>, dir: String) =
        pg.execInContainer("sh", "-c", "grep -rlaFs ${args.joinToString(" ") { "-e '$it'" }} $dir")

    // ---- tests -------------------------------------------------------------------------------------------------

    @Test fun `matcher control - every spelling of a sentinel is found`() {
        val s = "zqcontrol" + UUID.randomUUID().toString().replace("-", "") + "@x.test"
        for ((form, needle) in forms(s)) {
            for (k in 0..2) {
                val around = ByteArray(k) { 'A'.code.toByte() } + needle.toByteArray()
                assertTrue(needle in iso(around), form)
            }
        }
        // base64 inside a longer base64 text, at each alignment
        for (k in 0..2) {
            val text = Base64.getEncoder().encodeToString(ByteArray(k + 3) { 7 } + s.toByteArray() + ByteArray(k + 1) { 9 })
            assertTrue(forms(s).filterKeys { it.startsWith("b64+") }.values.any { it in text }, "base64 alignment $k")
        }
    }

    @Test fun `no sentinel in any table dump, bytea decode, pg_dump, data directory, object store, mail or log`() {
        seed()
        jdbc.execute("checkpoint")
        assertTrue(jdbc.queryForObject("select count(*) from app_user", Int::class.java)!! >= 3)

        assertNoLeaks(dbSources())
        assertNoLeaks(objectSources())
        // A mail may hold its recipient address, the link token and the code; a reply also holds the Client's address, the subject, the reply text and its file. Nothing else.
        with(SentinelCatalog) {
            val reply = mailTo(clientEmail, attachName)
            assertTrue(replyText in reply, "control: the reply mail carries its text")
            assertFalse(inquiryBody in reply || draftText in reply || clientName in reply, "a reply mail carries only what was sent")
            assertNoLeaks(
                mapOf("Mailpit messages" to mailSource()),
                skip = mailRecipients + mailed + setOf(clientEmail, inquirySubject, replyText, attachName, attachBody, awayClientEmail, awayClientName, awayMessage),
            )
        }
        with(SentinelCatalog) {
            // The away mail holds the message and the greeting by design; nothing of the inquiry, and only once for two inquiries.
            val away = mailTo(awayClientEmail, awayMessage)
            assertTrue(awayClientName in away, "control: the away mail greets the client")
            assertFalse(inquiryBody in away || inquirySubject in away || clientEmail in away, "an away mail carries only the message and the greeting")
            Thread.sleep(1500)
            assertEquals(1, mailIds("to:\"$awayClientEmail\"").size, "one away mail per client per window")
        }
        assertNoLeaks(mapOf("application log" to logSource()))

        // Heap, index and WAL files. Control first: a catalog name must be found, or the grep proves nothing.
        val control = dataDir(listOf("app_user"), "\$PGDATA")
        assertEquals(0, control.exitCode, "grep control over PGDATA: " + control.stderr)
        val plain = dataDir(SentinelCatalog.all, "\$PGDATA")
        assertEquals(1, plain.exitCode, "plaintext in PGDATA files: ${plain.stdout} ${plain.stderr}")
    }

    @Test fun `every stored value is an envelope or a fixed size key, and the object body is padded`() {
        seed()
        val bad = mutableListOf<String>()
        for (t in tables()) jdbc.queryForList("select * from \"$t\"").forEach { row ->
            row.forEach { (c, v) ->
                if (v == null) return@forEach
                when {
                    c.endsWith("_ct") -> if (v !is ByteArray || !Envelope.looksValid(v)) bad += "$t.$c not an envelope"
                    c.endsWith("_bidx") -> if (v !is ByteArray || v.size != 32) bad += "$t.$c not 32 bytes"
                    c == "wrapped_dek" -> if (v !is ByteArray || v.size != 60) bad += "$t.$c not 60 bytes"
                }
            }
        }
        assertTrue(bad.isEmpty(), bad.toString())
        assertTrue(SchemaAllowlist.violations(jdbc).isEmpty())
        val body = s3Client().use { it.getObjectAsBytes { r -> r.bucket(BUCKET).key(objectId.toString()) }.asByteArray() }
        assertEquals(1 + 12 + 64 * 1024 + 16, body.size)
        assertTrue(objectId.toString().matches(Regex("[0-9a-f-]{36}")))
    }

    @Test fun `every bucket key is a UUID, every body is padded, and nothing in the bucket names a type or file`() {
        seed()
        s3Client().use { c ->
            val keys = c.listObjectsV2 { it.bucket(BUCKET) }.contents().map { it.key() }
            assertTrue(keys.size >= 5, "planted object plus two photos with a thumbnail each: $keys")
            assertEquals(jdbc.queryForObject("select count(*) from stored_object", Int::class.java), keys.size, "every object has a key row and no discarded photo left an object: $keys")
            assertEquals(15, keys.size, "planted object, six kept photos with a thumbnail each, one avatar and one sent attachment")
            assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id is null and gown_id is null", Int::class.java))
            for (k in keys) {
                assertTrue(k.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")), k)
                val size = c.getObjectAsBytes { it.bucket(BUCKET).key(k) }.asByteArray().size
                assertTrue(size > 29 && (size - 29) % 65536 == 0, "body of $k is not padded to 64 KB steps: $size")
                val h = c.headObject { it.bucket(BUCKET).key(k) }
                assertEquals("application/octet-stream", h.contentType())
                assertTrue(h.metadata().isEmpty(), "user metadata on $k")
            }
        }
    }

    @Test fun `bodies swapped between two uploaded objects fail to decrypt`() {
        seed()
        val (admin, batch, photos) = uploaded!!
        val api = "http://127.0.0.1:${ctx.webServer!!.port}"
        fun original(id: String) = jdbc.queryForObject("select original_object_id from photo where id = ?", String::class.java, UUID.fromString(id))!!
        val (a, b) = photos.map(::original)
        s3Client().use { c ->
            fun body(k: String) = c.getObjectAsBytes { it.bucket(BUCKET).key(k) }.asByteArray()
            fun put(k: String, v: ByteArray) = c.putObject({ r -> r.bucket(BUCKET).key(k) }, RequestBody.fromBytes(v))
            val bodyA = body(a); val bodyB = body(b)
            try {
                put(a, bodyB); put(b, bodyA)
                val r = UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${photos[0]}?size=full", admin)
                assertEquals(500, r.status)
                assertTrue(r.text.contains("crypto_failure"), r.text)
            } finally {
                put(a, bodyA); put(b, bodyB)
            }
        }
        assertEquals(200, UploadClient.call("GET", "$api/api/v1/uploads/$batch/photos/${photos[0]}?size=full", admin).status)
    }

    @Test fun `the catalog names every ct column and only those`() {
        val actual = jdbc.queryForList(
            "select table_name || '.' || column_name from information_schema.columns where table_schema = 'public' and column_name like '%\\_ct'",
            String::class.java,
        ).toSet()
        assertEquals(actual, SentinelCatalog.columns.keys, "add a SentinelCatalog entry for every new _ct column (and remove stale ones)")
    }

    @Test fun `every encrypted entity has a Sentinel in the catalog`() {
        val tables = em.metamodel.entities.filter { !it.javaType.name.startsWith("co.klei.app.probe.") }
            .mapNotNull { it.javaType.getAnnotation(co.klei.crypto.EncryptedEntity::class.java)?.table }
        assertTrue(tables.size >= 20, "the scan found too few entities to prove anything: $tables")
        val covered = SentinelCatalog.columns.keys.map { it.substringBefore('.') }.toSet()
        assertEquals(emptyList(), tables.filter { it !in covered }, "an @EncryptedEntity has no SentinelCatalog entry")
    }

    @Test fun `ciphertext swapped between rows or between columns fails to decrypt`() {
        seed()
        val (a, b) = tx.execute { listOf(users.find(SentinelCatalog.email1)!!.id, users.find(SentinelCatalog.email2)!!.id) }!!
        fun blob(col: String, id: UUID) = jdbc.queryForObject("select $col from app_user where id = ?", ByteArray::class.java, id)!!
        fun load(id: UUID) = tx.execute { em.find(AppUser::class.java, id) }
        fun mustFail(id: UUID) {
            val e = assertFailsWith<Throwable> { load(id) }
            assertTrue(generateSequence<Throwable>(e) { it.cause }.any { it is CryptoException }, e.toString())
        }

        load(a); load(b)
        val na = blob("name_ct", a); val nb = blob("name_ct", b)
        try {
            jdbc.update("update app_user set name_ct = ? where id = ?", nb, a)
            jdbc.update("update app_user set name_ct = ? where id = ?", na, b)
            mustFail(a); mustFail(b)
        } finally {
            jdbc.update("update app_user set name_ct = ? where id = ?", na, a)
            jdbc.update("update app_user set name_ct = ? where id = ?", nb, b)
        }
        try {
            jdbc.update("update app_user set name_ct = email_ct, email_ct = name_ct where id = ?", a)
            mustFail(a)
        } finally {
            jdbc.update("update app_user set name_ct = email_ct, email_ct = name_ct where id = ?", a)
        }
        load(a); load(b)
    }
}
