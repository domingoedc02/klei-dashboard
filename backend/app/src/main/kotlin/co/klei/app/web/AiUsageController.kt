package co.klei.app.web

import co.klei.app.ai.AiUsagePage
import co.klei.app.ai.AiUsageQueryService
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** Read only (FR-39): the list never carries a prompt or a response, and no route here writes. */
@RestController
@RequestMapping("/api/v1/admin/ai/usage")
class AiUsageController(private val svc: AiUsageQueryService) {
    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @GetMapping
    fun page(@RequestParam("page", defaultValue = "1") page: Int): AiUsagePage {
        if (page < 1 || page > AiUsageQueryService.MAX_PAGE) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        return svc.page(page)
    }
}
