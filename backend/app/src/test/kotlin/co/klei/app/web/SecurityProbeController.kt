package co.klei.app.web

import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Test-only endpoints that prove the security foundation before real features exist. */
@RestController
@RequestMapping("/api/v1/probe")
class SecurityProbeController(private val idem: IdempotencyService) {
    private val version = AtomicLong(1)
    private val created = ConcurrentHashMap<String, UUID>()
    private val count = AtomicInteger()

    @PreAuthorize("hasAuthority('PERM_VIEW_GALLERY')")
    @GetMapping("/gallery")
    fun gallery(): Map<String, Boolean> = mapOf("ok" to true)

    @PreAuthorize("hasAuthority('PERM_VIEW_AUDIT')")
    @GetMapping("/audit")
    fun audit(): Map<String, Boolean> = mapOf("ok" to true)

    @PreAuthorize("hasAuthority('PERM_EDIT_GOWN')")
    @PatchMapping("/thing")
    fun patch(req: HttpServletRequest): Map<String, Long> {
        Versions.require(req, version.get())
        return mapOf("version" to version.incrementAndGet())
    }

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/things")
    fun create(req: HttpServletRequest, @RequestBody body: Map<String, String>): Map<String, String> {
        val key = idem.key(req)?.let { java.util.HexFormat.of().formatHex(it) }
        val id = if (key == null) newId() else created.computeIfAbsent(key) { newId() }
        return mapOf("id" to id.toString())
    }

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @GetMapping("/things/count")
    fun count(): Map<String, Int> = mapOf("count" to count.get())

    @PermitAll
    @GetMapping("/open")
    fun open(): Map<String, Boolean> = mapOf("ok" to true)

    private fun newId(): UUID = UUID.randomUUID().also { count.incrementAndGet() }
}

/** Opens the deliberately failing test paths; the production chain stays deny-by-default. */
@Configuration
class ProbeSecurity {
    @Bean
    @Order(0)
    fun probePaths(http: HttpSecurity): SecurityFilterChain = http
        .securityMatcher("/api/v1/boom/**", "/api/v1/probe/open")
        .csrf { it.disable() }
        .authorizeHttpRequests { it.anyRequest().permitAll() }
        .build()
}
