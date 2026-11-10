package co.klei.app.web

import co.klei.app.ai.AiConnectionTester
import co.klei.app.ai.AiModelsRequest
import co.klei.app.ai.AiModelsResult
import co.klei.app.ai.AiSettingService
import co.klei.app.ai.AiSettingsRequest
import co.klei.app.ai.AiSettingsRules
import co.klei.app.ai.AiSettingsView
import co.klei.app.ai.AiTestResult
import co.klei.app.security.Caller
import co.klei.core.ai.AiCall
import co.klei.core.ai.AiProviderException
import co.klei.core.ai.AiProviderPort
import co.klei.core.ai.AiPurpose
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** AI provider settings (FR-37, S7). Not transactional on purpose: the Test makes provider calls, which never run inside a transaction. */
@RestController
@RequestMapping("/api/v1/admin/ai")
class AiAdminController(private val settings: AiSettingService, private val tester: AiConnectionTester, private val port: AiProviderPort, private val clientIp: ClientIp) {
    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @GetMapping
    fun get(): AiSettingsView = settings.view()

    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @PutMapping
    fun put(@RequestBody body: AiSettingsRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): AiSettingsView {
        val ifMatch = Versions.sent(req)
        val problems = AiSettingsRules.check(body)
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        return settings.save(body, ifMatch, caller.id, clientIp.of(req))
    }

    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @PostMapping("/test")
    fun test(@AuthenticationPrincipal caller: Caller): AiTestResult = tester.run(caller.id)

    @PreAuthorize("hasAuthority('PERM_AI_SETTINGS')")
    @PostMapping("/models")
    fun models(@RequestBody body: AiModelsRequest, @AuthenticationPrincipal caller: Caller): AiModelsResult {
        val url = body.baseUrl?.trim().orEmpty()
        if (url.length > 2000 || AiSettingsRules.origin(url) == null) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("baseUrl", "invalid")))
        val key = body.apiKey
        if (key != null && (key.length > 500 || key.any { it <= ' ' || it.code == 127 })) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("apiKey", "invalid")))
        val (apiKey, org) = settings.draftCredentials(url, key, body.embedding == true)
        return try {
            AiModelsResult(port.listModels(AiCall(AiPurpose.TEST, caller.id), url, apiKey, org).take(500), null)
        } catch (e: AiProviderException) {
            AiModelsResult(emptyList(), e.detail)
        }
    }
}
