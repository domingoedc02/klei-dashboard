package co.klei.app.web

import co.klei.core.storage.ObjectStorePort
import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class HealthController(private val jdbc: JdbcTemplate, private val store: ObjectStorePort) {

    /** Liveness: the process answers. Touches nothing else. */
    @PermitAll
    @GetMapping("/health")
    fun live(): Map<String, String> = mapOf("status" to "up")

    /** Readiness: PostgreSQL and the bucket both answer. */
    @PermitAll
    @GetMapping("/health/ready")
    fun ready(req: HttpServletRequest): ResponseEntity<*> {
        val ok = runCatching { jdbc.queryForObject("select 1", Int::class.java) == 1 }.getOrDefault(false) && store.isReachable()
        return if (ok) ResponseEntity.ok(mapOf("status" to "up")) else Problems.response(ProblemCode.UNAVAILABLE, req)
    }
}
