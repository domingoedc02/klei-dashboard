package co.klei.app.web

import co.klei.app.notification.NotificationList
import co.klei.app.notification.NotificationService
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

class NotificationReadRequest {
    var ids: List<UUID>? = null
}

/** FR-29: the signed-in User's own bell; every Role has one. */
@RestController
@RequestMapping("/api/v1/notifications")
class NotificationController(private val notifications: NotificationService) {
    @TokenAuthorized
    @GetMapping
    fun list(@AuthenticationPrincipal caller: Caller): NotificationList = notifications.latest(caller.id)

    @TokenAuthorized
    @PostMapping("/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun read(@RequestBody body: NotificationReadRequest, @AuthenticationPrincipal caller: Caller) = notifications.markRead(caller.id, body.ids)

    @TokenAuthorized
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun clear(@AuthenticationPrincipal caller: Caller) = notifications.clear(caller.id)
}
