package co.klei.app.web

import co.klei.app.gown.DeleteResult
import co.klei.app.gown.GownDeleteService
import co.klei.app.gown.GownDetail
import co.klei.app.gown.ExportManifest
import co.klei.app.gown.GownEditService
import co.klei.app.gown.GownExportService
import co.klei.app.gown.GownPage
import co.klei.app.gown.GownQueryService
import co.klei.app.security.Caller
import co.klei.app.upload.ImageType
import co.klei.app.upload.GroupEdit
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class GownQueryRequest {
    var silhouette: List<UUID>? = null
    var fabric: List<UUID>? = null
    var days: Int? = null
    var before: Long? = null
    var limit: Int? = null
}

class GownExportRequest {
    var ids: List<UUID>? = null
}

class GownDeleteRequest {
    var ids: List<UUID>? = null
}

/** FR-13/FR-14: the Gallery. Filters travel in the body so no business value is ever in a URL. */
@RestController
@RequestMapping("/api/v1/gowns")
class GownQueryController(private val gowns: GownQueryService, private val edits: GownEditService, private val exports: GownExportService, private val deletes: GownDeleteService, private val clientIp: ClientIp) {

    @PreAuthorize("hasAuthority('PERM_VIEW_GALLERY')")
    @PostMapping("/query")
    fun query(@RequestBody body: GownQueryRequest): GownPage =
        gowns.query(GownQueryService.filter(body.silhouette, body.fabric, body.days, body.before, body.limit))

    @PreAuthorize("hasAuthority('PERM_VIEW_GALLERY')")
    @GetMapping("/{id}")
    fun get(@PathVariable("id") id: UUID): GownDetail = gowns.detail(id)

    /** FR-17: up to 100 ids and about 100 MB of photos, else 413. Unknown ids come back in `missing`. */
    @PreAuthorize("hasAuthority('PERM_VIEW_GALLERY')")
    @PostMapping("/export")
    fun export(@RequestBody body: GownExportRequest, @AuthenticationPrincipal caller: Caller): ExportManifest = exports.manifest(body.ids.orEmpty(), caller.id)

    /** FR-18: hard delete of up to 100 Gowns and their Photos. Unknown ids are skipped and come back in `missing`. */
    @PreAuthorize("hasAuthority('PERM_DELETE_GOWN')")
    @PostMapping("/delete")
    fun delete(@RequestBody body: GownDeleteRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): DeleteResult =
        deletes.delete(body.ids.orEmpty(), caller.id, clientIp.of(req))

    /** FR-16: a field left out stays as it is. 409 on a stale `If-Match`; 422 names the fields at fault. */
    @PreAuthorize("hasAuthority('PERM_EDIT_GOWN')")
    @PatchMapping("/{id}")
    fun edit(@PathVariable("id") id: UUID, @RequestBody body: GroupEdit, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): GownDetail {
        edits.edit(id, body, Versions.sent(req), caller.id, clientIp.of(req))
        return gowns.detail(id)
    }

    /** Bytes of one saved Photo, never cached, never sniffed by the browser. */
    @PreAuthorize("hasAuthority('PERM_VIEW_GALLERY')")
    @GetMapping("/{id}/photos/{photoId}")
    fun photo(
        @PathVariable("id") id: UUID,
        @PathVariable("photoId") photoId: UUID,
        @RequestParam("size", defaultValue = "thumb") size: String,
    ): ResponseEntity<ByteArray> {
        if (size != "thumb" && size != "full") throw ProblemException(ProblemCode.BAD_REQUEST)
        val (bytes, type) = gowns.image(id, photoId, size == "full")
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(type))
            .cacheControl(CacheControl.noStore())
            .header("X-Content-Type-Options", "nosniff")
            .header("X-Image-Type", ImageType.entries.first { it.mime == type }.format)
            .body(bytes)
    }
}
