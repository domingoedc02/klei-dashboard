package co.klei.app.web

import jakarta.annotation.security.PermitAll
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

/** Test-only: proves an unhandled exception leaves as a bare problem. */
@RestController
class BoomController {
    @PermitAll
    @GetMapping("/api/v1/boom/{id}")
    fun boom(@PathVariable id: String): String = throw IllegalStateException("SENTINEL-boom-$id")
}
