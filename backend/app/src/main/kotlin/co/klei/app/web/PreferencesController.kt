package co.klei.app.web

import co.klei.app.identity.PreferencesRequest
import co.klei.app.identity.PreferencesService
import co.klei.app.identity.PreferencesView
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** FR-33, FR-34: the signed-in User's own preferences; every Role has them. */
@RestController
@RequestMapping("/api/v1/me/preferences")
class PreferencesController(private val prefs: PreferencesService) {
    @TokenAuthorized
    @GetMapping
    fun get(@AuthenticationPrincipal caller: Caller): PreferencesView = prefs.get(caller.id)

    @TokenAuthorized
    @PutMapping
    fun put(@RequestBody body: PreferencesRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): PreferencesView =
        prefs.save(caller.id, body, Versions.sent(req))
}
