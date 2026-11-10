package co.klei.app.away

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.core.mail.MailPort
import co.klei.core.mail.MailTemplate
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

data class AwayView(val enabled: Boolean, val message: String, val schedule: AwaySchedule, val zone: String, val version: Long)

/** Plain vars: a client may omit any field, and a missing one must be a 422 on that field, not an unreadable body. */
class ScheduleRequest {
    var mode: String? = null
    var days: List<String>? = null
    var start: String? = null
    var end: String? = null
    var from: String? = null
    var to: String? = null
}

class AwayRequest {
    var enabled: Boolean? = null
    var message: String? = null
    var schedule: ScheduleRequest? = null
}

/** FR-32: the away message, its closure schedule, and the one mail a new inquiry may earn inside a closure window. */
@Service
class AwayService(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val users: UserService,
    private val audit: AuditService,
    private val mail: MailPort,
) {
    private val log = LoggerFactory.getLogger(AwayService::class.java)
    private val tx = TransactionTemplate(txm)
    internal var clock: Clock = Clock.systemUTC()

    @Transactional(readOnly = true)
    fun view(): AwayView = em.find(Away::class.java, ID)?.let(::toView) ?: DEFAULT

    @Transactional
    fun save(req: AwayRequest, ifMatch: Long, by: UUID, ip: String?): AwayView {
        val problems = check(req)
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        val actor = users.get(by)?.name ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val r = em.find(Away::class.java, ID, LockModeType.PESSIMISTIC_WRITE)
        if (ifMatch != (r?.let(::apiVersion) ?: 0L)) throw ProblemException(ProblemCode.CONFLICT)
        val enabled = req.enabled!!
        val message = req.message.orEmpty().trim()
        val q = req.schedule!!
        val schedule = AwaySchedule(q.mode!!, q.days.orEmpty(), q.start, q.end, q.from, q.to)
        val zone = zoneOf(by)
        val row = r ?: Away(ID, enabled, message, AwayStored(schedule = schedule, zone = zone)).also { em.persist(it) }
        val changed = buildList {
            if (r == null) { add("created"); return@buildList }
            if (row.enabled != enabled) add("enabled")
            if (row.message != message) add("message")
            if (row.schedule.schedule != schedule || row.schedule.zone != zone) add("schedule")
        }
        row.enabled = enabled
        row.message = message
        row.schedule = AwayStored(schedule = schedule, zone = zone)
        em.flush()
        // Names only: the message text is a client-facing mail and stays out of the audit log.
        if (changed.isNotEmpty()) audit.record(AuditAction.AWAY_CHANGED, detail = "changed: ${changed.joinToString(" ")}", actorId = by, actorName = actor, ip = ip)
        return toView(row)
    }

    /**
     * Called after a new inquiry has committed. Sends at most one away mail per client per closure window; the claim is recorded
     * before the mail leaves, so a failed send is not retried and a restart does not repeat it. Never throws: the inquiry stands.
     */
    fun onInquiry(clientId: UUID) {
        try {
            val send = tx.execute { claim(clientId, clock.instant()) } ?: return
            mail.send(MailTemplate.AWAY, send.first, send.second)
        } catch (e: Exception) {
            // Class name only: the message may hold the address.
            log.warn("away message not sent: {}", e.javaClass.simpleName)
        }
    }

    private fun claim(clientId: UUID, now: Instant): Pair<String, Map<String, String>>? {
        // The row lock also serialises two inquiries from one client, so the window is claimed once.
        val a = em.find(Away::class.java, ID, LockModeType.PESSIMISTIC_WRITE)?.takeIf { it.enabled } ?: return null
        val start = AwayWindow.start(a.schedule.schedule, now, ZoneId.of(a.schedule.zone)) ?: return null
        val seen = em.createQuery("select s from AwaySent s where s.clientId = :c", AwaySent::class.java).setParameter("c", clientId).resultList
        if (seen.any { it.windowStart == start }) return null
        val client = em.find(co.klei.app.inquiry.Client::class.java, clientId) ?: return null
        em.persist(AwaySent(UUID.randomUUID(), clientId, start))
        em.flush()
        val first = client.name.trim().substringBefore(' ').filter { !it.isISOControl() }.ifEmpty { "there" }
        return client.email to mapOf("body" to a.message, "first" to first)
    }

    private fun zoneOf(userId: UUID): String =
        users.get(userId)?.prefs?.timezone?.takeIf { it in ZoneId.getAvailableZoneIds() } ?: UTC

    private fun check(q: AwayRequest): List<FieldProblem> = buildList {
        val s = q.schedule
        if (q.enabled == null) add(FieldProblem("enabled", "required"))
        val message = q.message.orEmpty().trim()
        if (message.length > MAX_MESSAGE) add(FieldProblem("message", "too_long"))
        else if (q.enabled == true && message.isEmpty()) add(FieldProblem("message", "required"))
        if (s == null) { add(FieldProblem("schedule", "required")); return@buildList }
        val first = s.start?.let(::date)
        val last = s.end?.let(::date)
        if (s.start != null && first == null) add(FieldProblem("start", "invalid"))
        if (s.end != null && last == null) add(FieldProblem("end", "invalid"))
        val days = s.days.orEmpty()
        if (days.any { it !in AwayWindow.DAYS }) add(FieldProblem("days", "invalid"))
        val from = s.from?.let(::time)
        val to = s.to?.let(::time)
        if (s.from != null && from == null) add(FieldProblem("from", "invalid"))
        if (s.to != null && to == null) add(FieldProblem("to", "invalid"))
        when (s.mode) {
            "once" -> if (s.start == null) add(FieldProblem("start", "required")) else if (first != null && last != null && last < first) add(FieldProblem("end", "before_start"))
            "weekly" -> if (days.isEmpty()) add(FieldProblem("days", "required"))
            "daily" -> if (from == null || to == null) add(FieldProblem("from", "required")) else if (from == to) add(FieldProblem("to", "must_differ"))
            else -> add(FieldProblem("mode", "invalid"))
        }
    }

    private fun date(s: String): LocalDate? = runCatching { LocalDate.parse(s) }.getOrNull()
    private fun time(s: String): LocalTime? = if (TIME.matches(s)) LocalTime.parse(s) else null

    /** 0 means "no row yet", so two Admins who both opened the empty form cannot both create it. */
    private fun apiVersion(r: Away) = (r.version ?: -1) + 1

    private fun toView(r: Away) = AwayView(r.enabled, r.message, r.schedule.schedule, r.schedule.zone, apiVersion(r))

    companion object {
        val ID: UUID = UUID.fromString("00000000-0000-4000-8000-0000000000c1")
        const val MAX_MESSAGE = 2000
        private const val UTC = "UTC"
        private val TIME = Regex("([01]\\d|2[0-3]):[0-5]\\d")
        val DEFAULT = AwayView(
            false, "Thank you for your inquiry! We are away from the studio and will reply within two business days.",
            AwaySchedule(days = listOf("sun", "mon"), from = "18:00", to = "09:00"), UTC, 0,
        )
    }
}
