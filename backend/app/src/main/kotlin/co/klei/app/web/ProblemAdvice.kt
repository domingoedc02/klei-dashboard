package co.klei.app.web

import co.klei.app.security.SecurityProblems
import co.klei.crypto.CryptoException
import jakarta.persistence.OptimisticLockException
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatusCode
import org.springframework.http.ResponseEntity
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.AuthenticationException
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.context.request.ServletWebRequest
import org.springframework.web.context.request.WebRequest
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler

/**
 * Every error leaves as RFC 9457 problem+json from the fixed catalogue.
 * No exception message, stack or input value reaches the body or the log (AD-11, AD-14).
 */
@ControllerAdvice
class ProblemAdvice(private val security: SecurityProblems) : ResponseEntityExceptionHandler() {
    private val log = LoggerFactory.getLogger(ProblemAdvice::class.java)

    /** Method security (`@PreAuthorize`) throws inside the controller call, so it lands here, not in the filter chain. */
    @ExceptionHandler(AccessDeniedException::class, AuthenticationException::class)
    fun denied(ex: Exception, req: HttpServletRequest): ResponseEntity<String> =
        Problems.response(security.denied(req), req)

    @ExceptionHandler(ProblemException::class)
    fun problem(ex: ProblemException, req: HttpServletRequest): ResponseEntity<String> = Problems.response(ex.problem, req, ex.fields, ex.extensions)

    /** A write that raced another one on the same row (`@Version`) is a stale write like any other. */
    @ExceptionHandler(OptimisticLockException::class, OptimisticLockingFailureException::class)
    fun stale(ex: Exception, req: HttpServletRequest): ResponseEntity<String> = Problems.response(ProblemCode.CONFLICT, req)

    override fun handleExceptionInternal(
        ex: Exception, body: Any?, headers: HttpHeaders, statusCode: HttpStatusCode, request: WebRequest,
    ): ResponseEntity<Any>? {
        val problem = ProblemCode.forStatus(statusCode.value())
        val req = (request as ServletWebRequest).request
        return ResponseEntity.status(problem.status).contentType(Problems.MEDIA_TYPE)
            .body(Problems.json(problem, CorrelationIdFilter.of(req)))
    }

    @ExceptionHandler(Exception::class)
    fun unhandled(ex: Exception, req: HttpServletRequest): ResponseEntity<String> {
        // Class name only: the message may carry input or data.
        val crypto = generateSequence<Throwable>(ex) { it.cause }.filterIsInstance<CryptoException>().firstOrNull()
        if (crypto != null) {
            log.error("crypto failure code={}", crypto.code)
            return Problems.response(ProblemCode.CRYPTO_FAILURE, req)
        }
        log.error("unhandled {}", ex.javaClass.name)
        return Problems.response(ProblemCode.INTERNAL, req)
    }
}
