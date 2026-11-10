package co.klei.app.identity

import co.klei.app.TestSupport
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.PasswordHasher
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
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class IdentityIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var hasher: PasswordHasher
    @Autowired lateinit var bootstrap: BootstrapAdmin
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var users: UserService

    @Test fun `default roles carry the FR-36 matrix`() {
        val byName = roles.roles().associate { it.name to roles.permissions(it.id) }
        assertEquals(DefaultRoles.matrix, byName)
        assertTrue(Permission.PERM_VIEW_GALLERY in byName.getValue(DefaultRoles.VIEWER))
        assertEquals(Permission.entries.toSet(), byName.getValue(DefaultRoles.ADMIN))
    }

    @Test fun `bootstrap created one verified admin with a stored password hash and one audit entry`() {
        assertEquals(1, jdbc.queryForObject("select count(*) from app_user", Int::class.java))
        val u = tx.execute { roles.adminExists(); users.find(TestSupport.ADMIN_EMAIL) }!!
        assertEquals(UserStatus.ACTIVE, u.status)
        assertTrue(u.verified)
        assertTrue(hasher.verify(TestSupport.ADMIN_PASSWORD, u.password))
        assertEquals(1, bootstrapEntries())
    }

    @Test fun `a second start with the same variables creates nothing`() {
        bootstrap.run(org.springframework.boot.DefaultApplicationArguments())
        assertEquals(1, jdbc.queryForObject("select count(*) from app_user", Int::class.java))
        assertEquals(1, bootstrapEntries())
    }

    private fun bootstrapEntries() = tx.execute { audit.all().count { it.action == "bootstrap_admin" } }

    @Test fun `the email is found through its blind index only`() {
        assertEquals(TestSupport.ADMIN_EMAIL, tx.execute { users.find("  ADMIN@Example.test ") }!!.email)
        assertEquals(null, tx.execute { users.find("nobody@example.test") })
    }

    @Test fun `audit entries cannot be updated or deleted`() {
        assertFailsWith<Exception> { jdbc.update("update audit_entry set action_ct = action_ct") }
        assertFailsWith<Exception> { jdbc.update("delete from audit_entry") }
        assertFailsWith<Exception> { jdbc.execute("truncate audit_entry") }
    }

    @Test fun `audit record stores every field as an envelope`() {
        tx.executeWithoutResult { audit.record("test_action", "detail-x", ip = "10.0.0.1") }
        val row = jdbc.queryForMap("select * from audit_entry where seq = (select max(seq) from audit_entry)")
        for (c in listOf("ts_ct", "actor_name_ct", "action_ct", "detail_ct", "ip_ct")) assertTrue(co.klei.crypto.Envelope.looksValid(row[c] as ByteArray), c)
    }
}
