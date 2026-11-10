package co.klei.app.web

import co.klei.app.assistant.AssistantService
import co.klei.app.assistant.ChatView
import co.klei.app.security.Caller
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.Authentication
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** [inquiryId] is the thread the User has open, if any; it is only a hint for the context. */
class AssistantSendRequest {
    var text: String? = null
    var inquiryId: UUID? = null
}

/** FR-25..FR-27: the User's own assistant chat. Needs Reply to inquiries; the Gown suggestions in it need View gallery. */
@RestController
@RequestMapping("/api/v1/assistant/chat")
class AssistantController(private val assistant: AssistantService) {
    private fun gallery(auth: Authentication) = auth.authorities.any { it.authority == "PERM_VIEW_GALLERY" }

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @GetMapping
    fun chat(@AuthenticationPrincipal caller: Caller, auth: Authentication): ChatView = assistant.chat(caller.id, gallery(auth))

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/messages")
    @ResponseStatus(HttpStatus.CREATED)
    fun send(@AuthenticationPrincipal caller: Caller, auth: Authentication, @RequestBody body: AssistantSendRequest): ChatView =
        assistant.send(caller.id, body.text, body.inquiryId, gallery(auth))

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun clear(@AuthenticationPrincipal caller: Caller) = assistant.clear(caller.id)
}
