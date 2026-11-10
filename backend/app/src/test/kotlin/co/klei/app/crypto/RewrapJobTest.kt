package co.klei.app.crypto

import co.klei.app.TestSupport
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.notification.NotificationPort
import co.klei.crypto.CryptoModule
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RewrapJobTest {
    private fun env(active: Int) = mapOf(
        "KLEI_KEK_1" to TestSupport.key(1), "KLEI_KEK_2" to TestSupport.key(2), "KLEI_KEK_ACTIVE" to "$active",
        "KLEI_BIDX_KEY" to TestSupport.key(50), "KLEI_JWT_KEY" to TestSupport.key(100),
    )

    private fun job(active: Int) = RewrapJob(
        CryptoModule(env(active), mock(DataSource::class.java)).rotation, mock(DataSource::class.java), mock(AuditService::class.java),
        mock(NotificationPort::class.java), mock(RoleService::class.java), mock(UserService::class.java), mock(TransactionTemplate::class.java),
    )

    @Test fun `an active KEK below the highest one refuses before touching anything`() {
        val e = assertFailsWith<ProblemException> { job(1).start(UUID.randomUUID(), null) }
        assertEquals(ProblemCode.CONFLICT, e.problem)
        assertEquals("active_not_highest", e.extensions["check"])
    }
}
