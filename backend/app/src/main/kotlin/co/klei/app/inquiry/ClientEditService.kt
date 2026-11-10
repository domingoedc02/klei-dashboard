package co.klei.app.inquiry

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.UUID

object ClientLimits {
    const val PHONE = 40
    const val CITY = 80
    const val NOTE = 2000
    val SOURCES = listOf("Website", "Instagram", "Referral", "Event", "Other")
}

/**
 * FR-23: a Client's phone, city, wedding date, source and note. Name and email are not editable here (email is the blind-index key).
 * The call carries all five: a blank or missing one clears it. No Audit Entry: no [co.klei.core.audit.AuditAction] covers it.
 */
@Service
class ClientEditService(private val em: EntityManager) {
    @Transactional
    fun edit(id: UUID, ifMatch: Long, phone: String?, city: String?, weddingDate: String?, source: String?, note: String?) {
        val c = em.find(Client::class.java, id, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (ifMatch != c.version) throw ProblemException(ProblemCode.CONFLICT)
        val bad = mutableListOf<FieldProblem>()
        // shortcut: lengths count UTF-16 units like the other forms, switch to code points if a language needs it.
        fun text(field: String, v: String?, max: Int, oneLine: Boolean): String? {
            val t = v?.trim().orEmpty()
            if (t.isEmpty()) return null
            if (t.length > max) bad += FieldProblem(field, "too_long") else if (oneLine && t.any { it < ' ' }) bad += FieldProblem(field, "invalid")
            return t
        }
        val p = text("phone", phone, ClientLimits.PHONE, true)
        val ci = text("city", city, ClientLimits.CITY, true)
        val n = text("note", note, ClientLimits.NOTE, false)
        val d = weddingDate?.trim().orEmpty().ifEmpty { null }?.also {
            try { if (it.length != 10) throw DateTimeParseException("", it, 0) else LocalDate.parse(it) } catch (e: DateTimeParseException) { bad += FieldProblem("weddingDate", "invalid") }
        }
        val s = source?.trim().orEmpty().ifEmpty { null }?.also { if (it !in ClientLimits.SOURCES) bad += FieldProblem("source", "invalid") }
        if (bad.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, bad)
        c.phone = p; c.city = ci; c.weddingDate = d; c.source = s; c.note = n
        em.flush()
    }
}
