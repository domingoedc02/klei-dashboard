package co.klei.app.web

import co.klei.app.security.Caller
import co.klei.app.upload.BatchView
import co.klei.app.upload.GroupEdit
import co.klei.app.upload.GroupView
import co.klei.app.upload.GroupingService
import co.klei.app.upload.RewriteBody
import co.klei.app.upload.Rewritten
import co.klei.app.upload.UploadGroupService
import co.klei.app.upload.StatusView
import co.klei.app.upload.PhotoIngestService
import co.klei.app.upload.UploadBatchService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.util.UUID

data class PhotoCreated(val id: UUID)

/** FR-8: the caller's one Upload Batch and the files in it. Every route is scoped to the caller; another User's ids answer 404. */
@RestController
@RequestMapping("/api/v1/uploads")
class UploadController(
    private val batches: UploadBatchService,
    private val ingest: PhotoIngestService,
    private val idem: IdempotencyService,
    private val grouping: GroupingService,
    private val groups: UploadGroupService,
) {
    /** 422 without Photos; calling it while processing returns the running status; from `error` it resumes (Retry). */
    /** Review edit (FR-10): 409 on a stale `If-Match` or outside `review`, 422 for an empty name or a tag the Taxonomy does not hold. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PatchMapping("/{id}/groups/{gid}")
    fun editGroup(
        @PathVariable("id") id: UUID,
        @PathVariable("gid") gid: UUID,
        @RequestBody body: GroupEdit,
        req: HttpServletRequest,
        @AuthenticationPrincipal caller: Caller,
    ): GroupView = groups.edit(caller.id, id, gid, body, Versions.sent(req))

    /** One AI call, nothing stored (Story 11.6): 502 when the provider fails, 409 outside `review`. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/groups/{gid}/rewrite")
    fun rewrite(
        @PathVariable("id") id: UUID,
        @PathVariable("gid") gid: UUID,
        @RequestBody body: RewriteBody,
        @AuthenticationPrincipal caller: Caller,
    ): Rewritten = grouping.rewrite(caller.id, id, gid, body.photoIds.orEmpty())

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/start")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun start(@PathVariable("id") id: UUID, @AuthenticationPrincipal caller: Caller): StatusView = grouping.start(caller.id, id)

    /** Polled every 2 s while the Processing screen shows. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @GetMapping("/{id}")
    fun status(@PathVariable("id") id: UUID, @AuthenticationPrincipal caller: Caller): StatusView = grouping.status(caller.id, id)

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping
    fun open(@AuthenticationPrincipal caller: Caller): BatchView = batches.ensure(caller.id)

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @GetMapping("/current")
    fun current(@AuthenticationPrincipal caller: Caller): BatchView = batches.current(caller.id)

    /** One file per call so progress and failures are per file. The client's filename is stored encrypted and never echoed. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/photos", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @ResponseStatus(HttpStatus.CREATED)
    fun add(
        @PathVariable("id") id: UUID,
        @RequestPart("file") file: MultipartFile,
        req: HttpServletRequest,
        @AuthenticationPrincipal caller: Caller,
    ): PhotoCreated {
        val key = idem.key(req) ?: throw ProblemException(ProblemCode.BAD_REQUEST)
        return PhotoCreated(ingest.add(caller.id, id, key, file.originalFilename, file.size) { file.bytes })
    }

    /** Bytes only for the batch owner, never cached, never sniffed by the browser. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @GetMapping("/{id}/photos/{photoId}")
    fun read(
        @PathVariable("id") id: UUID,
        @PathVariable("photoId") photoId: UUID,
        @RequestParam("size", defaultValue = "thumb") size: String,
        @AuthenticationPrincipal caller: Caller,
    ): ResponseEntity<ByteArray> {
        if (size != "thumb" && size != "full") throw ProblemException(ProblemCode.BAD_REQUEST)
        val (bytes, type) = batches.image(caller.id, id, photoId, size == "full")
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(type))
            .cacheControl(CacheControl.noStore())
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
    }

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @DeleteMapping("/{id}/photos/{photoId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable("id") id: UUID, @PathVariable("photoId") photoId: UUID, @AuthenticationPrincipal caller: Caller) =
        batches.deletePhoto(caller.id, id, photoId)
}
