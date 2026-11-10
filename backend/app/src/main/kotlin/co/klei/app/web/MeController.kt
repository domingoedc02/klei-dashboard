package co.klei.app.web

import co.klei.app.identity.AvatarService
import co.klei.app.identity.PreferencesService
import co.klei.app.identity.PreferencesView
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import jakarta.servlet.http.HttpServletRequest
import java.util.UUID

data class MeResponse(val id: UUID, val name: String, val email: String, val role: String, val permissions: List<String>, val avatar: Long? = null, val preferences: PreferencesView? = null)

@RestController
@RequestMapping("/api/v1")
class MeController(private val users: UserService, private val roles: RoleService, private val avatars: AvatarService) {
    /** The signed-in User with the Role name and Permissions the desktop app renders from. */
    @TokenAuthorized
    @ApiResponse(responseCode = "200", content = [Content(mediaType = "application/json", schema = Schema(implementation = MeResponse::class))])
    @GetMapping("/me")
    fun me(@AuthenticationPrincipal caller: Caller, req: HttpServletRequest): ResponseEntity<*> {
        val user = users.get(caller.id) ?: return Problems.response(ProblemCode.UNAUTHENTICATED, req)
        val role = roles.roles().firstOrNull { it.id == user.roleId }?.name ?: return Problems.response(ProblemCode.UNAUTHENTICATED, req)
        val perms = roles.permissions(user.roleId).map { it.name }.sorted()
        return ResponseEntity.ok(MeResponse(user.id, user.name, user.email, role, perms, avatars.revision(user), PreferencesService.view(user.prefs)))
    }
}
