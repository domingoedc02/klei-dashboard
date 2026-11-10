package co.klei.app.web

import co.klei.app.inquiry.ClientDetail
import co.klei.app.inquiry.ClientEditService
import co.klei.app.inquiry.InquiryDetailService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class ClientPatch {
    var phone: String? = null
    var city: String? = null
    var weddingDate: String? = null
    var source: String? = null
    var note: String? = null
}

/** FR-23: a Client and the Inquiries they have sent. */
@RestController
@RequestMapping("/api/v1/clients")
class ClientController(private val detail: InquiryDetailService, private val edits: ClientEditService) {
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @GetMapping("/{id}")
    fun get(@PathVariable("id") id: UUID): ClientDetail = detail.client(id)

    /** Replaces the five editable fields; answers the Client with its new version. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PatchMapping("/{id}")
    fun edit(@PathVariable("id") id: UUID, @RequestBody body: ClientPatch, req: HttpServletRequest): ClientDetail {
        edits.edit(id, Versions.sent(req), body.phone, body.city, body.weddingDate, body.source, body.note)
        return detail.client(id)
    }
}
