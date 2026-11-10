package co.klei.app.ai

import co.klei.core.ai.AiCall
import co.klei.core.ai.AiOutcome
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** Writes the `ai_usage` row of one call in its own transaction, so a failed call or a rolled-back caller still leaves it (AD-13). */
@Component
class AiUsageRecorder(private val em: EntityManager) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun record(call: AiCall, model: String?, size: Long?, outcome: AiOutcome, durationMs: Long, prompt: String, response: String) {
        val row = AiUsage(UUID.randomUUID(), call.userId, call.purpose, outcome, durationMs, Instant.now())
        row.model = model
        row.size = size
        row.prompt = prompt
        row.response = response
        em.persist(row)
    }
}
