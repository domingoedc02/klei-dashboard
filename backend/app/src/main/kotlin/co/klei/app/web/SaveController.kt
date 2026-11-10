package co.klei.app.web

import co.klei.app.gown.CommitBody
import co.klei.app.gown.CommitService
import co.klei.app.gown.SaveBatchService
import co.klei.app.gown.Saved
import co.klei.app.security.Caller
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** FR-12: Save the batch as Gowns, or throw it away. */
@RestController
@RequestMapping("/api/v1/uploads")
class SaveController(private val save: SaveBatchService, private val commit: CommitService, private val clientIp: ClientIp) {
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/save")
    fun save(@PathVariable("id") id: UUID, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): Saved =
        save.save(caller.id, id, clientIp.of(req))

    /** Confirm and save (Story 11.6): the staged review and the Save in one transaction. 409 when a Group changed since it was loaded; nothing is written. */
    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @PostMapping("/{id}/commit")
    fun commit(@PathVariable("id") id: UUID, @RequestBody body: CommitBody, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): Saved =
        commit.commit(caller.id, id, body, clientIp.of(req))

    @PreAuthorize("hasAuthority('PERM_UPLOAD_IMAGES')")
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun discard(@PathVariable("id") id: UUID, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller) =
        save.discard(caller.id, id, clientIp.of(req))
}
