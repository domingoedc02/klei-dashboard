package co.klei.app.web

import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import co.klei.app.taxonomy.TaxonomyChange
import co.klei.app.taxonomy.TaxonomyService
import co.klei.app.taxonomy.TaxonomyView
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** Tag Taxonomy (FR-38). Reading is open to any signed-in User because Gallery and Upload need the lists. */
@RestController
@RequestMapping("/api/v1/taxonomy")
class TaxonomyController(private val taxonomy: TaxonomyService, private val clientIp: ClientIp) {
    @TokenAuthorized
    @GetMapping
    fun get(): TaxonomyView = taxonomy.view()

    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @PutMapping
    fun put(@RequestBody body: TaxonomyChange, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): TaxonomyView =
        taxonomy.apply(body, { Versions.sent(req) }, caller.id, clientIp.of(req))
}
