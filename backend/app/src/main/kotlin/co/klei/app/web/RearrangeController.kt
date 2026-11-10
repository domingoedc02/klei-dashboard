package co.klei.app.web

import co.klei.app.security.Caller
import co.klei.app.upload.MergeBody
import co.klei.app.upload.MoveBody
import co.klei.app.upload.Rearranged
import co.klei.app.upload.RearrangeService
import co.klei.app.upload.SplitBody
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** FR-11: rearranging Photos in review. `If-Match` is the version of the Group the Photos leave; every answer lists the Groups again. */
@RestController
@RequestMapping("/api/v1/uploads")
class RearrangeController(private val rearrange: RearrangeService) {
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/photos/{pid}/move")
    fun move(
        @PathVariable("id") id: UUID, @PathVariable("pid") pid: UUID, @RequestBody body: MoveBody,
        req: HttpServletRequest, @AuthenticationPrincipal caller: Caller,
    ): Rearranged = rearrange.move(caller.id, id, pid, body, Versions.sent(req))

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/photos/{pid}/discard")
    fun discard(
        @PathVariable("id") id: UUID, @PathVariable("pid") pid: UUID,
        req: HttpServletRequest, @AuthenticationPrincipal caller: Caller,
    ): Rearranged = rearrange.discard(caller.id, id, pid, Versions.sent(req))

    /** Undo of a discard; needs no `If-Match` because it only adds a Photo. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/photos/{pid}/restore")
    fun restore(
        @PathVariable("id") id: UUID, @PathVariable("pid") pid: UUID, @RequestBody body: MoveBody,
        @AuthenticationPrincipal caller: Caller,
    ): Rearranged = rearrange.restore(caller.id, id, pid, body)

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/groups/{gid}/split")
    fun split(
        @PathVariable("id") id: UUID, @PathVariable("gid") gid: UUID, @RequestBody body: SplitBody,
        req: HttpServletRequest, @AuthenticationPrincipal caller: Caller,
    ): Rearranged = rearrange.split(caller.id, id, gid, body, Versions.sent(req))

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/merge")
    fun merge(
        @PathVariable("id") id: UUID, @RequestBody body: MergeBody,
        req: HttpServletRequest, @AuthenticationPrincipal caller: Caller,
    ): Rearranged = rearrange.merge(caller.id, id, body, Versions.sent(req))
}
