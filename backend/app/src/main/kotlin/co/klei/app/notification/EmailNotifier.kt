package co.klei.app.notification

import co.klei.app.identity.AppUser
import co.klei.app.identity.Prefs
import co.klei.app.identity.PreferencesService
import co.klei.core.mail.MailPort
import co.klei.core.mail.MailTemplate
import co.klei.core.notification.NotificationType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** FR-34, real-time email: one mail per event for a User on "Real-time" with that event's email switch on. `MailPort.send` waits for the commit. */
@Component
class EmailNotifier(private val mail: MailPort) {
    private val log = LoggerFactory.getLogger(EmailNotifier::class.java)

    fun realtime(u: AppUser, type: NotificationType, title: String) {
        val p = u.prefs ?: return
        if (p.digest != PreferencesService.REALTIME || !wants(p, type)) return
        try {
            mail.send(MailTemplate.NOTIFY, u.email, mapOf("title" to oneLine(title)))
        } catch (e: Exception) {
            log.warn("notify mail not sent: {}", e.javaClass.simpleName) // class name only: the message may hold the address
        }
    }

    companion object {
        fun wants(p: Prefs, type: NotificationType): Boolean = when (type) {
            NotificationType.NEW_INQUIRY -> p.emailNewInquiry
            NotificationType.AI_FINISHED -> p.emailAiFinished
            NotificationType.TEAM_ACTIVITY -> p.emailTeamActivity
        }

        /** A title is untrusted text; one line keeps it from forging mail structure. */
        fun oneLine(title: String) = title.replace(Regex("\\s+"), " ").trim()
    }
}
