package co.klei.core.notification

import java.util.UUID

/** Stored lower case. Each type has its own toggle in the recipient's preferences (Story 6.3). */
enum class NotificationType { AI_FINISHED, NEW_INQUIRY, TEAM_ACTIVITY }

/** The only way to raise a Notification. Called inside the business transaction, so a rollback leaves none; recipients with the toggle off or not Active get no row. */
interface NotificationPort {
    fun notify(type: NotificationType, recipients: List<UUID>, title: String, target: String?)
}
