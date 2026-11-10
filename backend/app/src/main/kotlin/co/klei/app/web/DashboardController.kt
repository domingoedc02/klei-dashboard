package co.klei.app.web

import co.klei.app.dashboard.DashboardService
import co.klei.app.dashboard.DashboardView
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import org.springframework.security.core.Authentication
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** FR-7: the home screen's numbers. Gown figures need View gallery, Inquiry figures need Reply; any signed-in User gets the AI status. */
@RestController
@RequestMapping("/api/v1/dashboard")
class DashboardController(private val dashboard: DashboardService) {
    @TokenAuthorized
    @GetMapping
    fun get(@AuthenticationPrincipal caller: Caller, auth: Authentication): DashboardView {
        val has = auth.authorities.map { it.authority }.toSet()
        return dashboard.view(caller.id, "PERM_VIEW_GALLERY" in has, "PERM_REPLY" in has)
    }
}
