package co.klei.app.web

import co.klei.app.crypto.KeyStatus
import co.klei.app.crypto.RewrapJob
import co.klei.app.crypto.RewrapRun
import co.klei.app.security.Caller
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** FR-41: the Key panel. Counts and version numbers only; key material and wrapped keys never leave the process. */
@RestController
@RequestMapping("/api/v1/admin/keys")
class KeyStatusController(private val job: RewrapJob, private val clientIp: ClientIp) {
    @PreAuthorize("hasAuthority('PERM_KEY_ROTATE')")
    @GetMapping("/status")
    fun status(): KeyStatus = job.status()

    /** 202 while a run is going, 200 with zero counts when nothing needed re-wrapping, 409 when the active KEK is not the newest or a run is on. */
    @PreAuthorize("hasAuthority('PERM_KEY_ROTATE')")
    @PostMapping("/rewrap")
    fun rewrap(req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<RewrapRun> {
        val run = job.start(caller.id, clientIp.of(req))
        return ResponseEntity.status(if (run.state == "running") 202 else 200).body(run)
    }
}
