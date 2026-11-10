package co.klei.app.web

import co.klei.app.identity.RoleAdminService
import co.klei.app.identity.RoleMatrix
import co.klei.app.identity.RoleView
import co.klei.app.security.Caller
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class RolePermissionsRequest {
    var roleId: UUID? = null
    var permissions: List<String>? = null
}

@RestController
@RequestMapping("/api/v1/admin/roles")
class RoleAdminController(private val svc: RoleAdminService, private val clientIp: ClientIp) {
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @GetMapping
    fun matrix(): RoleMatrix = svc.matrix()

    /** Replaces the Role's whole set. Takes effect at once: every access token goes stale and the next request refreshes. */
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @PutMapping
    fun replace(@RequestBody body: RolePermissionsRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): RoleView {
        val ifMatch = Versions.sent(req)
        val roleId = body.roleId
        val permissions = body.permissions
        if (roleId == null || permissions == null || permissions.size > MAX_PERMISSIONS) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        return svc.replace(roleId, permissions.toSet(), ifMatch, caller.id, clientIp.of(req))
    }

    private companion object {
        const val MAX_PERMISSIONS = 32
    }
}
