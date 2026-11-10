package co.klei.app.inquiry

import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.Terms
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/** Writes `inquiry_term` from the Client's name and the subject, so search (Story 8.2) never has to decrypt a row to find a word. */
@Component
class InquiryTermIndexer(private val em: EntityManager, private val bidx: BlindIndex) {
    fun index(inquiryId: UUID, clientName: String, subject: String) {
        for (word in Terms.of("$clientName $subject")) em.persist(InquiryTerm(UUID.randomUUID(), inquiryId, bidx.of(BidxDomain.INQUIRY_TERM, word)))
    }
}
