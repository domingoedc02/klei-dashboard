package co.klei.app.web

import co.klei.app.inquiry.AttachmentService
import co.klei.app.inquiry.AttachmentView
import co.klei.app.inquiry.DetailMessage
import co.klei.app.inquiry.DraftSaved
import co.klei.app.inquiry.DraftService
import co.klei.app.inquiry.DraftView
import co.klei.app.inquiry.InquiryCount
import co.klei.app.inquiry.InquiryDetail
import co.klei.app.inquiry.InquiryDetailService
import co.klei.app.inquiry.InquiryItem
import co.klei.app.inquiry.InquiryPage
import co.klei.app.inquiry.InquiryService
import co.klei.app.inquiry.InquiryStatusService
import co.klei.app.inquiry.StatusChanged
import co.klei.app.inquiry.ReplyService
import co.klei.app.security.Caller
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.Authentication
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class NewInquiryRequest {
    var clientName: String? = null
    var clientEmail: String? = null
    var subject: String? = null
    var body: String? = null
}

class InquiryQueryRequest {
    var status: String? = null
    var before: Long? = null
    var limit: Int? = null
}

/** FR-19 and FR-24: the Inbox. Filters travel in the body so no business value is ever in a URL. */
@RestController
@RequestMapping("/api/v1/inquiries")
class InquiryController(
    private val inquiries: InquiryService,
    private val detail: InquiryDetailService,
    private val idem: IdempotencyService,
    private val drafts: DraftService,
    private val files: AttachmentService,
    private val replies: ReplyService,
    private val statuses: InquiryStatusService,
    private val clientIp: ClientIp,
) {

    /** 201 for a new Inquiry, 200 with the same body when the `Idempotency-Key` was used before. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping
    fun create(@RequestBody body: NewInquiryRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<InquiryItem> {
        val input = InquiryService.clean(body.clientName, body.clientEmail, body.subject, body.body)
        val made = inquiries.create(input, caller.id, idem.key(req))
        return ResponseEntity.status(if (made.created) HttpStatus.CREATED else HttpStatus.OK).body(made.item)
    }

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/query")
    fun query(@RequestBody body: InquiryQueryRequest): InquiryPage = inquiries.query(InquiryService.filter(body.status, body.before, body.limit))

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @GetMapping("/count")
    fun count(): InquiryCount = inquiries.count()

    /** FR-20: the whole thread in time order. Never marks anything read. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @GetMapping("/{id}")
    fun get(@PathVariable("id") id: UUID): InquiryDetail = detail.detail(id)

    /** FR-24: opening an Inquiry clears its unread flag for everyone; 204 also when it was already read. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun read(@PathVariable("id") id: UUID) = detail.markRead(id)

    /** FR-22: New, Replied or Closed with `If-Match`; to or from Closed also needs `PERM_CLOSE_INQUIRY`. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PatchMapping("/{id}")
    fun setStatus(
        @PathVariable("id") id: UUID,
        @RequestBody body: StatusPatch,
        req: HttpServletRequest,
        @AuthenticationPrincipal caller: Caller,
        auth: Authentication,
    ): StatusChanged =
        statuses.change(id, body.status, Versions.sent(req), auth.authorities.any { it.authority == "PERM_CLOSE_INQUIRY" }, caller.id, clientIp.of(req))

    /** FR-21: the caller's own unsent Reply; empty text and no files when there is none. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @GetMapping("/{id}/draft")
    fun draft(@PathVariable("id") id: UUID, @AuthenticationPrincipal caller: Caller): DraftView = drafts.get(id, caller.id)

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PutMapping("/{id}/draft")
    fun saveDraft(@PathVariable("id") id: UUID, @RequestBody body: ReplyRequest, @AuthenticationPrincipal caller: Caller): DraftSaved =
        drafts.put(id, caller.id, body.body)

    /** Drops the text and the unsent files; 204 each time it is called. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @DeleteMapping("/{id}/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun discardDraft(@PathVariable("id") id: UUID, @AuthenticationPrincipal caller: Caller) = drafts.discard(id, caller.id)

    /** One file per call, like photos. The file name is stored encrypted and never echoed in an error. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/{id}/attachments", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @ResponseStatus(HttpStatus.CREATED)
    fun attach(
        @PathVariable("id") id: UUID,
        @RequestPart("file") file: MultipartFile,
        req: HttpServletRequest,
        @AuthenticationPrincipal caller: Caller,
    ): AttachmentView {
        val key = idem.key(req) ?: throw ProblemException(ProblemCode.BAD_REQUEST)
        return files.add(id, caller.id, key, file.originalFilename, file.size) { file.bytes }
    }

    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @DeleteMapping("/{id}/attachments/{fileId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun detach(@PathVariable("id") id: UUID, @PathVariable("fileId") fileId: UUID, @AuthenticationPrincipal caller: Caller) = files.remove(id, caller.id, fileId)

    /** 201 for a new Reply (even when the mail failed: `mailState` says so), 200 with the first Message for a repeated `Idempotency-Key`. */
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/{id}/reply")
    fun reply(
        @PathVariable("id") id: UUID,
        @RequestBody body: ReplyRequest,
        req: HttpServletRequest,
        @AuthenticationPrincipal caller: Caller,
    ): ResponseEntity<DetailMessage> {
        val key = idem.key(req) ?: throw ProblemException(ProblemCode.BAD_REQUEST)
        val sent = replies.reply(id, caller.id, body.body, key, clientIp.of(req))
        return ResponseEntity.status(if (sent.created) HttpStatus.CREATED else HttpStatus.OK).body(detail.message(sent.messageId))
    }
}

class StatusPatch {
    var status: String? = null
}

class ReplyRequest {
    var body: String? = null
}

/** FR-21: send a reply again that the mail server did not take. */
@RestController
@RequestMapping("/api/v1/messages")
class MessageController(private val replies: ReplyService, private val detail: InquiryDetailService) {
    @PreAuthorize("hasAuthority('PERM_REPLY')")
    @PostMapping("/{id}/retry")
    fun retry(@PathVariable("id") id: UUID): DetailMessage = detail.message(replies.retry(id))
}
