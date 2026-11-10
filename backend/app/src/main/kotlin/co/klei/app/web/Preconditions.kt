package co.klei.app.web

import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import jakarta.servlet.http.HttpServletRequest
import org.springframework.stereotype.Component

/** A 422 may name the fields at fault by fixed code only; the submitted value is never echoed (NFR-1). */
data class FieldProblem(val field: String, val code: String)

/** A refusal raised from anywhere in a request; the advice turns it into the one problem body for its code. */
/** [extensions] carries numbers or fixed strings a client needs for one code (409 `usedBy`, `check`); keys and string values are fixed, never request input. */
class ProblemException(val problem: ProblemCode, val fields: List<FieldProblem> = emptyList(), val extensions: Map<String, Any> = emptyMap()) : RuntimeException(problem.code, null, false, false)

/** AD-18: `If-Match` carries the version the client last read. */
object Versions {
    /** The version the client sent; 400 when the header is missing or not a number. */
    fun sent(req: HttpServletRequest): Long =
        req.getHeader("If-Match")?.trim()?.trim('"')?.toLongOrNull() ?: throw ProblemException(ProblemCode.BAD_REQUEST)

    fun require(req: HttpServletRequest, current: Long?): Long {
        val sent = sent(req)
        if (sent != current) throw ProblemException(ProblemCode.CONFLICT)
        return sent
    }
}

/**
 * `Idempotency-Key` to its blind index. Owners of a create-style endpoint look the index up in their own
 * `idem_bidx` column; a hit means the call already happened and the stored result is returned instead.
 */
@Component
class IdempotencyService(private val bidx: BlindIndex) {
    fun key(req: HttpServletRequest): ByteArray? {
        val raw = req.getHeader("Idempotency-Key") ?: return null
        if (raw.length !in 1..128 || raw.any { it < ' ' || it > '~' }) throw ProblemException(ProblemCode.BAD_REQUEST)
        return bidx.of(BidxDomain.IDEM, raw)
    }
}
