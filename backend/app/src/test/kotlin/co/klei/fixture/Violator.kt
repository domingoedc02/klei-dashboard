package co.klei.fixture

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.security.SecureRandom

/** Deliberate violations. Only the negative architecture test reads this package. */
@RestController
class Violator {
    @GetMapping("/x")
    fun open(): Int = SecureRandom().nextInt()
}
