package co.klei.app.web

import co.klei.app.auth.CredentialService
import co.klei.app.identity.StaffList
import co.klei.app.identity.StaffRow
import co.klei.app.identity.StaffService
import co.klei.app.mail.SmtpMailAdapter
import co.klei.app.security.Caller
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class InviteRequest {
    var name: String? = null
    var email: String? = null
    var roleId: UUID? = null
}

class UpdateStaffRequest {
    var name: String? = null
    var email: String? = null
    var roleId: UUID? = null
}

private fun validName(s: String) = s.isNotEmpty() && s.length <= 100
private fun validEmail(s: String) = s.length <= 254 && SmtpMailAdapter.ADDRESS.matches(s)

data class InvitedUser(val id: UUID, val name: String, val email: String, val roleId: UUID, val status: String)

@RestController
@RequestMapping("/api/v1/admin/users")
class AdminUsersController(
    private val credentials: CredentialService,
    private val staff: StaffService,
    private val clientIp: ClientIp,
) {
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @GetMapping
    fun list(): StaffList = staff.list()

    /** Only the fields sent change. A stale `If-Match` is 409; demoting the last Active Admin is 409 too. */
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @PatchMapping("/{id}")
    fun update(@PathVariable("id") id: UUID, @RequestBody body: UpdateStaffRequest, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): StaffRow {
        val name = body.name?.trim()
        val email = body.email?.trim()
        if (name != null && !validName(name) || email != null && !validEmail(email)) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        return staff.update(id, name, email, body.roleId, Versions.sent(req), caller.id, clientIp.of(req))
    }

    /** Invited Users only: the earlier invitation stops working and a new mail goes out. */
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @PostMapping("/{id}/resend")
    fun resend(@PathVariable("id") id: UUID, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<Void> {
        staff.resend(id, caller.id, clientIp.of(req))
        return ResponseEntity.noContent().build()
    }

    /** 409 when the User has no active second factor. */
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @PostMapping("/{id}/2fa/reset")
    fun resetTwoFactor(@PathVariable("id") id: UUID, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<Void> {
        staff.resetTwoFactor(id, caller.id, clientIp.of(req))
        return ResponseEntity.noContent().build()
    }

    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @DeleteMapping("/{id}")
    fun delete(@PathVariable("id") id: UUID, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<Void> {
        staff.delete(id, caller.id, clientIp.of(req))
        return ResponseEntity.noContent().build()
    }

    /** Creates an Invited User and mails the invitation. 409 `conflict` when the email already has an account. */
    @PreAuthorize("hasAuthority('PERM_MANAGE_STAFF')")
    @ApiResponse(responseCode = "201", content = [Content(mediaType = "application/json", schema = Schema(implementation = InvitedUser::class))])
    @PostMapping
    fun invite(@RequestBody body: InviteRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<InvitedUser> {
        val name = body.name?.trim().orEmpty()
        val email = body.email?.trim().orEmpty()
        val roleId = body.roleId
        if (!validName(name) || !validEmail(email) || roleId == null) {
            throw ProblemException(ProblemCode.VALIDATION_FAILED)
        }
        val u = credentials.invite(name, email, roleId, caller.id)
        return ResponseEntity.status(HttpStatus.CREATED).body(InvitedUser(u.id, u.name, u.email, u.roleId, "invited"))
    }
}
