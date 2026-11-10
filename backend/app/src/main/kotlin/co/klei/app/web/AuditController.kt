package co.klei.app.web

import co.klei.app.identity.AuditPage
import co.klei.app.identity.AuditQueryService
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** Read only: no route here edits or deletes an Audit Entry (FR-40). */
@RestController
@RequestMapping("/api/v1/admin/audit")
class AuditController(private val svc: AuditQueryService) {
    @PreAuthorize("hasAuthority('PERM_VIEW_AUDIT')")
    @GetMapping
    fun page(@RequestParam("page", defaultValue = "1") page: Int): AuditPage {
        if (page < 1 || page > AuditQueryService.MAX_PAGE) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        return svc.page(page)
    }
}
