package co.klei.app.web

import co.klei.app.away.AwayRequest
import co.klei.app.away.AwayService
import co.klei.app.away.AwayView
import co.klei.app.security.Caller
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** The away message and closure schedule (FR-32). Admin only; `If-Match` carries the version. */
@RestController
@RequestMapping("/api/v1/admin/away")
class AwayController(private val away: AwayService, private val clientIp: ClientIp) {
    @PreAuthorize("hasAuthority('PERM_AWAY')")
    @GetMapping
    fun get(): AwayView = away.view()

    @PreAuthorize("hasAuthority('PERM_AWAY')")
    @PutMapping
    fun put(@RequestBody body: AwayRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): AwayView =
        away.save(body, Versions.sent(req), caller.id, clientIp.of(req))
}
