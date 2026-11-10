package co.klei.app.web

import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import co.klei.app.signature.SignatureRequest
import co.klei.app.signature.SignatureService
import co.klei.app.signature.SignatureView
import co.klei.app.signature.WorkspaceRequest
import co.klei.app.signature.WorkspaceService
import co.klei.app.signature.WorkspaceView
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** FR-31: the signed-in User's own reply signature, with the Studio lines it ends on. */
@RestController
@RequestMapping("/api/v1/me/signature")
class SignatureController(private val signatures: SignatureService) {
    @TokenAuthorized
    @GetMapping
    fun get(@AuthenticationPrincipal caller: Caller): SignatureView = signatures.get(caller.id)

    @TokenAuthorized
    @PutMapping
    fun put(@RequestBody body: SignatureRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): SignatureView =
        signatures.save(caller.id, body, Versions.sent(req))
}

/** FR-31: the Studio block, edited by an Admin who manages staff. */
@RestController
@RequestMapping("/api/v1/admin/workspace")
class WorkspaceController(private val workspace: WorkspaceService) {
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @GetMapping
    fun get(): WorkspaceView = workspace.get()

    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @PutMapping
    fun put(@RequestBody body: WorkspaceRequest, req: HttpServletRequest): WorkspaceView = workspace.save(body, Versions.sent(req))
}
