package co.klei.app.assistant

import co.klei.app.TestSupport
import co.klei.app.ai.StubProvider
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.gown.Gown
import co.klei.app.gown.TermIndexer
import co.klei.app.identity.Role
import co.klei.app.identity.RolePermission
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
import co.klei.app.upload.UploadClient
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
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
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 8.3: the assistant chat through a loopback provider: who may ask, what is sent, what is stored, what a failure shows. */
@Testcontainers
@Import(RecordingMailConfig::class, AssistantIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AssistantIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private val stub = StubProvider()
        private const val PW = "Assist-pass-1"
        private val signed = mutableMapOf<String, String>()

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            r.add("klei.ai.dev-mode") { "true" }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }

        @AfterAll @JvmStatic fun stopStub() = stub.close()
    }

    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var bidx: BlindIndex
    @Autowired lateinit var terms: TermIndexer
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", api)
    private fun tokenFor(roleId: UUID, name: String = "Asha Assist"): String {
        val email = "as-${UUID.randomUUID()}@example.test"
        tx.execute { users.create(name, email, PW, roleId, UserStatus.ACTIVE, true) }
        val c = client()
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }
    private fun token(role: String) = tokenFor(roles.roles().first { it.name == role }.id)
    private fun roleOf(name: String, vararg perms: Permission): UUID {
        val id = UUID.randomUUID()
        tx.execute { em.persist(Role(id, name)); em.flush(); perms.forEach { em.persist(RolePermission(UUID.randomUUID(), id, it)) } }
        return id
    }

    private fun json(method: String, path: String, token: String?, body: String? = null, version: Long? = null) =
        UploadClient.call(
            method, "$api$path", token, body?.toByteArray(),
            buildMap { if (body != null) put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )
    private fun ask(token: String?, text: String, inquiry: String? = null) =
        json("POST", "/api/v1/assistant/chat/messages", token, """{"text":${Json.encodeToString(kotlinx.serialization.serializer<String>(), text)}${inquiry?.let { ""","inquiryId":"$it"""" } ?: ""}}""")
    private fun lines(r: UploadClient.Resp) = Json.parseToJsonElement(r.text).jsonObject["messages"]!!.jsonArray.map { it.jsonObject }
    private fun history(token: String) = lines(json("GET", "/api/v1/assistant/chat", token))
    private fun usage() = jdbc.queryForObject("select count(*) from ai_usage", Int::class.java)!!
    private fun chatBodies() = stub.seen.filter { it.substringBefore(" | ").endsWith("/chat/completions") }.map { it.substringAfterLast(" | ") }

    private fun configure(chatModel: String?) {
        val cur = json("GET", "/api/v1/admin/ai", admin)
        val v = Regex(""""version":(\d+)""").find(cur.text)!!.groupValues[1].toLong()
        val body = """{"preset":"litellm","baseUrl":"${stub.baseUrl}","apiKey":"sk-assistant-key-0123456789","organization":"org-x","chatModel":${chatModel?.let { "\"$it\"" } ?: "null"},"visionModel":null,"embeddingModel":"dinov2-base","temperature":0.7,"maxTokens":1024}"""
        assertEquals(200, json("PUT", "/api/v1/admin/ai", admin, body, v).status)
    }

    private fun seedGown(name: String): UUID {
        val id = UUID.randomUUID()
        val at = Instant.now().minus(3, ChronoUnit.DAYS)
        tx.execute {
            em.persist(Gown(id, name, "A soft gown", 90, at, true, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$id")))
            em.flush()
        }
        tx.execute { terms.reindex(listOf(em.find(Gown::class.java, id)!!)) }
        return id
    }

    private fun inquire(name: String, email: String, subject: String, body: String = "Hello"): String {
        val r = json("POST", "/api/v1/inquiries", staff, """{"clientName":"$name","clientEmail":"$email","subject":"$subject","body":"$body"}""")
        assertEquals(201, r.status, r.text)
        return r.id()
    }

    private val admin get() = signed.getValue("admin")
    private val staff get() = signed.getValue("staff")
    private val other get() = signed.getValue("other")
    private val viewer get() = signed.getValue("viewer")
    private val replyOnly get() = signed.getValue("replyOnly")

    @BeforeEach
    fun reset() {
        if (signed.isEmpty()) {
            signed["admin"] = tokenFor(roles.roles().first { it.name == DefaultRoles.ADMIN }.id)
            signed["staff"] = token(DefaultRoles.STAFF)
            signed["other"] = token(DefaultRoles.STAFF)
            signed["viewer"] = token(DefaultRoles.VIEWER)
            signed["replyOnly"] = tokenFor(roleOf("Mailer", Permission.PERM_REPLY))
        }
        stub.mode = StubProvider.Mode.OK
        stub.chatsLeft.set(Int.MAX_VALUE)
        stub.chatAnswer = { "Here is a short answer." }
        stub.seen.clear()
        configure("chat-x")
        jdbc.update("delete from chat_message")
        jdbc.update("delete from gown")
        jdbc.update("delete from inquiry")
        jdbc.update("delete from client")
    }

    @Test fun `sign-in and Reply to inquiries are required, a Viewer is refused everywhere`() {
        assertEquals(401, json("GET", "/api/v1/assistant/chat", null).status)
        assertEquals(401, ask(null, "hi").status)
        assertEquals(403, json("GET", "/api/v1/assistant/chat", viewer).status)
        assertEquals(403, ask(viewer, "hi").status)
        assertEquals(403, json("DELETE", "/api/v1/assistant/chat", viewer).status)
        assertEquals(0, chatBodies().size)
    }

    @Test fun `a new User has an empty chat`() {
        assertEquals(emptyList(), history(staff))
    }

    @Test fun `a question is answered, stored in order and costs one usage row`() {
        val before = usage()
        val r = ask(staff, "Hello there")
        assertEquals(201, r.status, r.text)
        val made = lines(r)
        assertEquals(listOf("user", "assistant"), made.map { it["role"]!!.jsonPrimitive.content })
        assertEquals("Here is a short answer.", made[1]["text"]!!.jsonPrimitive.content)
        assertEquals(before + 1, usage())
        val seen = stub.seen.single { it.contains("Hello there") }
        ask(staff, "And again")
        val all = history(staff)
        assertEquals(listOf("Hello there", "Here is a short answer.", "And again", "Here is a short answer."), all.map { it["text"]!!.jsonPrimitive.content })
        assertTrue(seen.contains("Bearer sk-assistant-key-0123456789"), seen)
        assertTrue(seen.contains("Klei Assistant"), "the system prompt goes first")
    }

    @Test fun `only the last ten chat lines are sent as history`() {
        repeat(6) { ask(staff, "Question number $it") }
        ask(staff, "The seventh")
        val sent = Json.parseToJsonElement(chatBodies().last()).jsonObject["messages"]!!.jsonArray
        assertEquals(1 + 10 + 1, sent.size)
        assertEquals("system", sent.first().jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("The seventh", sent.last().jsonObject["content"]!!.jsonPrimitive.content)
    }

    @Test fun `empty, missing and oversized text is a 422 and sends nothing`() {
        assertEquals(422, ask(staff, "   ").status)
        assertEquals(422, json("POST", "/api/v1/assistant/chat/messages", staff, "{}").status)
        val big = ask(staff, "x".repeat(4001))
        assertEquals(422, big.status)
        assertTrue(big.text.contains(""""code":"too_long""""), big.text)
        assertEquals(201, ask(staff, "x".repeat(4000)).status)
        assertEquals(1, chatBodies().size)
    }

    @Test fun `without a chat model the answer is a 409 not_configured and nothing is stored`() {
        configure(null)
        val r = ask(staff, "Hello")
        assertEquals(409, r.status, r.text)
        assertTrue(r.text.contains(""""check":"not_configured""""), r.text)
        assertEquals(emptyList(), history(staff))
        assertEquals(0, chatBodies().size)
    }

    @Test fun `a failing provider is a 502 with a fixed code, no provider text, and nothing is stored`() {
        stub.chatsLeft.set(0)
        val r = ask(staff, "Hello")
        assertEquals(502, r.status, r.text)
        assertTrue(r.text.contains("ai_provider_failed"), r.text)
        assertFalse(r.text.contains("PROVIDER-SECRET-TEXT"), r.text)
        assertEquals(emptyList(), history(staff))
        stub.chatsLeft.set(Int.MAX_VALUE)
        assertEquals(201, ask(staff, "Hello again").status)
    }

    @Test fun `each User sees and clears only their own chat`() {
        ask(staff, "Mine alone")
        ask(other, "Theirs alone")
        assertEquals(listOf("Mine alone", "Here is a short answer."), history(staff).map { it["text"]!!.jsonPrimitive.content })
        assertEquals(204, json("DELETE", "/api/v1/assistant/chat", staff).status)
        assertEquals(emptyList(), history(staff))
        assertEquals(2, history(other).size)
    }

    @Test fun `summaries send at most 20 items of 2 KB and never an email address`() {
        repeat(25) { inquire("Client $it", "private$it@example.test", "Subject $it", "x".repeat(10_000)) }
        assertEquals(201, ask(staff, "Summarize new inquiries").status)
        val body = chatBodies().single()
        assertFalse(body.contains("example.test"), "no address leaves")
        val system = Json.parseToJsonElement(body).jsonObject["messages"]!!.jsonArray[0].jsonObject["content"]!!.jsonPrimitive.content
        val items = system.lines().filter { Regex("""^\d+\. """).containsMatchIn(it) }
        assertTrue(items.size in 1..20, items.size.toString())
        assertTrue(items.all { it.substringAfter(". ").toByteArray().size <= 2048 })
        assertTrue(items.first().contains("Inquiry: client"))
    }

    @Test fun `an open thread is sent with its messages for a draft`() {
        val id = inquire("Priya Nair", "priya@example.test", "Fitting in June", "Can we move to veilsentinel next week")
        assertEquals(201, ask(staff, "Draft a reply", id).status)
        val body = chatBodies().single()
        assertTrue(body.contains("veilsentinel") && body.contains("Priya Nair"), body)
        assertFalse(body.contains("priya@example.test"))
    }

    @Test fun `a Gown the context offered becomes a link, a stranger's token is dropped`() {
        val g = seedGown("Magnolia")
        stub.chatAnswer = { b -> "Try [gown:${Regex("""\[gown:([0-9a-f-]{36})]""").find(b)?.groupValues?.get(1) ?: UUID.randomUUID()}] or [gown:${UUID.randomUUID()}] today." }
        val made = lines(ask(staff, "Suggest gowns"))
        assertEquals("Try Magnolia or  today.".replace("  ", " "), made[1]["text"]!!.jsonPrimitive.content)
        val refs = made[1]["gowns"]!!.jsonArray
        assertEquals(1, refs.size)
        assertEquals(g.toString(), refs[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("Magnolia", refs[0].jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals(JsonArray(emptyList()), refs[0].jsonObject["thumbs"])
        assertEquals(1, (history(staff)[1]["gowns"] as JsonArray).size, "the link survives a reload")
    }

    @Test fun `without View gallery no Gown reaches the provider and none comes back`() {
        seedGown("Magnolia")
        stub.chatAnswer = { b -> "Try [gown:${Regex("""\[gown:([0-9a-f-]{36})]""").find(b)?.groupValues?.get(1) ?: UUID.randomUUID()}]." }
        val made = lines(ask(replyOnly, "Suggest gowns"))
        assertFalse(chatBodies().single().contains("Magnolia"))
        assertEquals(JsonArray(emptyList()), made[1]["gowns"])
    }
}
