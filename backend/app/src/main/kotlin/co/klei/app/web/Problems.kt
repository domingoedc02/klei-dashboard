package co.klei.app.web

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity

/** Fixed catalogue (architecture §7.3). Nothing in a problem body is built from request input. */
enum class ProblemCode(val status: Int, val code: String, val title: String) {
    BAD_REQUEST(400, "bad_request", "Bad request"),
    UNAUTHENTICATED(401, "unauthenticated", "Sign-in required"),
    TOKEN_STALE(401, "token_stale", "Sign-in out of date"),
    FORBIDDEN(403, "forbidden", "Not allowed"),
    NOT_FOUND(404, "not_found", "Not found"),
    METHOD_NOT_ALLOWED(405, "method_not_allowed", "Method not allowed"),
    CONFLICT(409, "conflict", "Conflict"),
    TOO_LARGE(413, "too_large", "Too large"),
    UNSUPPORTED_TYPE(415, "unsupported_type", "Unsupported type"),
    VALIDATION_FAILED(422, "validation_failed", "Validation failed"),
    RATE_LIMITED(429, "rate_limited", "Too many requests"),
    UNAVAILABLE(503, "unavailable", "Service unavailable"),
    INTERNAL(500, "internal", "Internal error"),
    AI_PROVIDER_FAILED(502, "ai_provider_failed", "AI provider failed"),
    CRYPTO_FAILURE(500, "crypto_failure", "Internal error");

    companion object {
        fun forStatus(status: Int): ProblemCode = entries.firstOrNull { it.status == status } ?: INTERNAL
    }
}

object Problems {
    val MEDIA_TYPE: MediaType = MediaType.APPLICATION_PROBLEM_JSON

    fun json(p: ProblemCode, correlationId: String, fields: List<FieldProblem> = emptyList(), extensions: Map<String, Any> = emptyMap()): String {
        val f = if (fields.isEmpty()) "" else fields.joinToString(",", ",\"fields\":[", "]") { """{"field":"${it.field}","code":"${it.code}"}""" }
        val x = if (extensions.isEmpty()) "" else extensions.entries.joinToString(",", ",\"extensions\":{", "}") { "\"${it.key}\":${(it.value as? String)?.let { s -> "\"$s\"" } ?: it.value}" }
        return """{"type":"https://klei.app/problems/${p.code}","title":"${p.title}","status":${p.status},"code":"${p.code}","correlationId":"$correlationId"$f$x}"""
    }

    fun response(p: ProblemCode, request: HttpServletRequest, fields: List<FieldProblem> = emptyList(), extensions: Map<String, Any> = emptyMap()): ResponseEntity<String> =
        ResponseEntity.status(p.status).contentType(MEDIA_TYPE).body(json(p, CorrelationIdFilter.of(request), fields, extensions))

    fun write(p: ProblemCode, request: HttpServletRequest, response: HttpServletResponse) {
        response.status = p.status
        response.contentType = MEDIA_TYPE.toString()
        response.characterEncoding = "UTF-8"
        response.writer.write(json(p, CorrelationIdFilter.of(request)))
    }
}
