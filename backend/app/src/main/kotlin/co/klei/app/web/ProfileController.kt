package co.klei.app.web

import co.klei.app.auth.PasswordChangeService
import co.klei.app.identity.AvatarService
import co.klei.app.identity.ProfileService
import co.klei.app.identity.ProfileView
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.util.UUID

class ProfilePatch { var name: String? = null }
class PasswordChange { var current: String? = null; var new: String? = null }

/** FR-30: the signed-in User's own name, photo and password. Every route acts on the caller; no id is taken from the request. */
@RestController
@RequestMapping("/api/v1/me")
class ProfileController(
    private val profile: ProfileService,
    private val avatars: AvatarService,
    private val passwords: PasswordChangeService,
    private val clientIp: ClientIp,
) {
    @TokenAuthorized
    @GetMapping("/profile")
    fun get(@AuthenticationPrincipal caller: Caller): ProfileView = profile.get(caller.id)

    @TokenAuthorized
    @PatchMapping("/profile")
    fun rename(@RequestBody body: ProfilePatch, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ProfileView =
        profile.rename(caller.id, body.name, Versions.sent(req))

    @TokenAuthorized
    @PutMapping("/avatar", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun setAvatar(@RequestPart("file") file: MultipartFile, @AuthenticationPrincipal caller: Caller): ProfileView {
        avatars.set(caller.id, file.size) { file.bytes }
        return profile.get(caller.id)
    }

    @TokenAuthorized
    @DeleteMapping("/avatar")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun removeAvatar(@AuthenticationPrincipal caller: Caller) = avatars.remove(caller.id)

    /** Never cached, never sniffed. The stored object is always a JPEG. */
    @TokenAuthorized
    @GetMapping("/avatar")
    fun avatar(@AuthenticationPrincipal caller: Caller): ResponseEntity<ByteArray> =
        ResponseEntity.ok()
            .contentType(MediaType.IMAGE_JPEG)
            .cacheControl(CacheControl.noStore())
            .header("X-Content-Type-Options", "nosniff")
            .body(avatars.read(caller.id))

    @TokenAuthorized
    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun password(@RequestBody body: PasswordChange, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller) {
        val (current, new) = body.current to body.new
        if (current.isNullOrEmpty() || current.length > 128) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("current", "required")))
        if (new.isNullOrEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("new", "required")))
        passwords.change(caller.id, UUID.fromString(caller.sid), current, new, clientIp.of(req))
    }
}
