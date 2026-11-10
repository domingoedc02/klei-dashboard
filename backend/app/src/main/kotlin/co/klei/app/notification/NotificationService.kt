package co.klei.app.notification

import co.klei.app.identity.AppUser
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.UserStatus
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

class NotificationItem(val id: UUID, val type: String, val title: String, val target: String?, val read: Boolean, val createdAt: Instant)

/** [unread] counts the [items] shown, not every row ever stored. */
class NotificationList(val items: List<NotificationItem>, val unread: Int)

/**
 * FR-29: the only writer of `notification` rows. A row joins the caller's transaction, so a rollback leaves none.
 * A recipient who is not Active gets nothing; one who switched the type off in Preferences (Story 6.3) gets no row.
 * Real-time email (Story 11.13) does not depend on the in-app switch; the digest reads the rows, so it does.
 */
@Service
class NotificationService(private val em: EntityManager, private val email: EmailNotifier) : NotificationPort {

    @Transactional
    override fun notify(type: NotificationType, recipients: List<UUID>, title: String, target: String?) {
        val now = Instant.now()
        for (id in recipients.distinct()) {
            val u = em.find(AppUser::class.java, id) ?: continue
            if (u.status != UserStatus.ACTIVE) continue
            if (wants(u, type)) em.persist(Notification(UUID.randomUUID(), id, type, title, target, now))
            email.realtime(u, type, title)
        }
    }

    private fun wants(u: AppUser, type: NotificationType): Boolean = when (type) {
        NotificationType.NEW_INQUIRY -> u.prefs?.newInquiry != false
        NotificationType.AI_FINISHED -> u.prefs?.aiFinished != false
        NotificationType.TEAM_ACTIVITY -> u.prefs?.teamActivity != false
    }

    @Transactional(readOnly = true)
    fun latest(userId: UUID): NotificationList {
        // shortcut: the newest 20 only, and `unread` counts those 20; add paging if the bell ever needs history.
        val rows = em.createQuery("select n from Notification n where n.userId = :u order by n.seq desc", Notification::class.java)
            .setParameter("u", userId).setMaxResults(LIMIT).resultList
        val items = rows.map { NotificationItem(it.id, it.type.name.lowercase(), it.title, it.target, it.read, it.createdAt) }
        return NotificationList(items, items.count { !it.read })
    }

    /** Ids that are not the caller's are skipped without a word, so one User cannot probe another's bell. */
    @Transactional
    fun markRead(userId: UUID, ids: List<UUID>?) {
        if (ids.isNullOrEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("ids", "required")))
        if (ids.size > MAX_IDS) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("ids", "too_many")))
        em.createQuery("select n from Notification n where n.userId = :u and n.id in :ids", Notification::class.java)
            .setParameter("u", userId).setParameter("ids", ids.distinct()).resultList.forEach { if (!it.read) it.read = true }
    }

    @Transactional
    fun clear(userId: UUID) {
        em.createQuery("delete from Notification n where n.userId = :u").setParameter("u", userId).executeUpdate()
    }

    companion object {
        const val LIMIT = 20
        const val MAX_IDS = 50
    }
}
