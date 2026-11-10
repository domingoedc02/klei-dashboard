package co.klei.app.identity

import co.klei.app.boot.StartupCheckException
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.mockito.Mockito.verifyNoInteractions
import org.springframework.boot.DefaultApplicationArguments
import org.springframework.mock.env.MockEnvironment
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class BootstrapAdminTest {
    private val users = mock(UserService::class.java)
    private val audit = mock(AuditService::class.java)
    private val tm = mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenReturn(SimpleTransactionStatus()) }

    private fun run(email: String?, password: String?): StartupCheckException {
        val env = MockEnvironment()
        email?.let { env.setProperty(BootstrapAdmin.EMAIL, it) }
        password?.let { env.setProperty(BootstrapAdmin.PASSWORD, it) }
        val boot = BootstrapAdmin(env, mock(RoleService::class.java), users, audit, TransactionTemplate(tm))
        val e = assertFailsWith<StartupCheckException> { boot.run(DefaultApplicationArguments()) }
        verifyNoInteractions(users, audit)
        password?.let { assertFalse(e.message!!.contains(it), "the value must not appear in the error") }
        return e
    }

    @Test fun `short password stops the boot with a code and no value`() {
        val e = run("a@example.test", "abc1")
        assertEquals("weak_password", e.code)
        assertEquals(listOf(BootstrapAdmin.PASSWORD), e.variables)
    }

    @Test fun `password without a digit stops the boot`() = assertEquals("weak_password", run("a@example.test", "no-digits-here").code)

    @Test fun `missing values are named`() {
        val e = run(null, null)
        assertEquals("missing_variable", e.code)
        assertEquals(listOf(BootstrapAdmin.EMAIL, BootstrapAdmin.PASSWORD), e.variables)
    }

    @Test fun `email without at sign is malformed`() = assertEquals("malformed_variable", run("nobody", "Admin-pass-123").code)
}
