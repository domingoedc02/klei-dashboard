package co.klei.app.identity

import co.klei.core.audit.AuditAction
import co.klei.app.boot.StartupCheckException
import co.klei.core.identity.PasswordPolicy
import co.klei.core.identity.UserStatus
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import java.nio.file.Files
import java.nio.file.Path

/** Startup check 6 (architecture §9.2): with no Admin yet, create one verified Admin from the environment. */
@Component
@Order(3)
class BootstrapAdmin(
    private val env: Environment,
    private val roles: RoleService,
    private val users: UserService,
    private val audit: AuditService,
    private val tx: TransactionTemplate,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        tx.executeWithoutResult {
            if (roles.adminExists()) return@executeWithoutResult
            val email = value(EMAIL)
            val password = value(PASSWORD)
            val missing = listOfNotNull(EMAIL.takeIf { email == null }, PASSWORD.takeIf { password == null })
            if (missing.isNotEmpty()) throw StartupCheckException("missing_variable", missing)
            if (!email!!.contains('@')) throw StartupCheckException("malformed_variable", listOf(EMAIL))
            if (!PasswordPolicy.accepts(password!!)) throw StartupCheckException("weak_password", listOf(PASSWORD))
            users.create("Admin", email, password, roles.adminRoleId(), UserStatus.ACTIVE, verified = true)
            audit.record(AuditAction.BOOTSTRAP_ADMIN)
        }
    }

    private fun value(name: String): String? =
        (env.getProperty(name) ?: env.getProperty("${name}_FILE")?.let { Files.readString(Path.of(it)) })?.trim()?.takeIf { it.isNotEmpty() }

    companion object {
        const val EMAIL = "KLEI_BOOTSTRAP_ADMIN_EMAIL"
        const val PASSWORD = "KLEI_BOOTSTRAP_ADMIN_PASSWORD"
    }
}
