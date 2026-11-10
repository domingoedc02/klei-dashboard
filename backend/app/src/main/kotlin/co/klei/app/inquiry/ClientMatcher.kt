package co.klei.app.inquiry

import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** FR-19: the Client is found by the HMAC of the email address; a new address creates one. An existing Client keeps the name it has. */
@Component
class ClientMatcher(private val em: EntityManager, private val bidx: BlindIndex) {
    fun match(name: String, email: String, now: Instant): Client =
        find(email) ?: Client(UUID.randomUUID(), name, email, now).also { em.persist(it) }

    fun find(email: String): Client? =
        em.createQuery("select c from Client c where c.emailBidx = :b", Client::class.java)
            .setParameter("b", bidx.of(BidxDomain.CLIENT_EMAIL, email)).resultList.firstOrNull()
}
