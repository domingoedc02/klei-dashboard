package co.klei.app.identity

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import kotlinx.serialization.Serializable
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/** The stored envelope: `v` is the schema version the field codec requires, `rev` the version the API shows (0 = never saved). */
@Serializable
class Prefs(
    val v: Int = 2,
    val rev: Long,
    val timezone: String?,
    val dateFormat: String,
    val startPage: String,
    val enterToSend: Boolean,
    val newInquiry: Boolean,
    val aiFinished: Boolean,
    val teamActivity: Boolean,
    // v2 (Story 11.13): rows saved before it have none of these and read as off / never.
    val emailNewInquiry: Boolean = false,
    val emailAiFinished: Boolean = false,
    val emailTeamActivity: Boolean = false,
    val digest: String = "never",
)

/** `timezone` null means "this computer's zone"; the server then reads dates as UTC. */
data class PreferencesView(
    val timezone: String?,
    val dateFormat: String,
    val startPage: String,
    val enterToSend: Boolean,
    val newInquiry: Boolean,
    val aiFinished: Boolean,
    val teamActivity: Boolean,
    val emailNewInquiry: Boolean,
    val emailAiFinished: Boolean,
    val emailTeamActivity: Boolean,
    val digest: String,
    val version: Long,
)

data class PreferencesRequest(
    val timezone: String? = null,
    val dateFormat: String? = null,
    val startPage: String? = null,
    val enterToSend: Boolean? = null,
    val newInquiry: Boolean? = null,
    val aiFinished: Boolean? = null,
    val teamActivity: Boolean? = null,
    /** The four email fields may be left out: the stored value stays (a client older than Story 11.13). */
    val emailNewInquiry: Boolean? = null,
    val emailAiFinished: Boolean? = null,
    val emailTeamActivity: Boolean? = null,
    val digest: String? = null,
)

/** FR-33, FR-34: the signed-in User's own preferences. No Audit Entry: personal, not an Admin action (FR-40 does not list them). */
@Service
class PreferencesService(private val em: EntityManager, private val users: UserService) {
    @Transactional(readOnly = true)
    fun get(userId: UUID): PreferencesView = view(users.get(userId)?.prefs)

    /** The date format and zone the User chose, for plain-text outputs the server builds (the Gown export). */
    @Transactional(readOnly = true)
    fun dates(userId: UUID): DateTimeFormatter = dateFormatter(users.get(userId)?.prefs)

    @Transactional
    fun save(userId: UUID, req: PreferencesRequest, ifMatch: Long): PreferencesView {
        val problems = check(req)
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        val u = em.find(AppUser::class.java, userId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        if (ifMatch != (u.prefs?.rev ?: 0L)) throw ProblemException(ProblemCode.CONFLICT)
        val old = u.prefs
        u.prefs = Prefs(
            rev = ifMatch + 1, timezone = req.timezone, dateFormat = req.dateFormat!!, startPage = req.startPage!!, enterToSend = req.enterToSend!!,
            newInquiry = req.newInquiry!!, aiFinished = req.aiFinished!!, teamActivity = req.teamActivity!!,
            emailNewInquiry = req.emailNewInquiry ?: old?.emailNewInquiry ?: false,
            emailAiFinished = req.emailAiFinished ?: old?.emailAiFinished ?: false,
            emailTeamActivity = req.emailTeamActivity ?: old?.emailTeamActivity ?: false,
            digest = req.digest ?: old?.digest ?: NEVER,
        )
        em.flush()
        return view(u.prefs)
    }

    private fun check(q: PreferencesRequest): List<FieldProblem> = buildList {
        if (q.timezone != null && q.timezone !in ZoneId.getAvailableZoneIds()) add(FieldProblem("timezone", "invalid"))
        pick("dateFormat", q.dateFormat, DATE_FORMATS.keys)
        pick("startPage", q.startPage, START_PAGES)
        if (q.digest != null && q.digest !in DIGESTS) add(FieldProblem("digest", "invalid"))
        for ((f, v) in listOf("enterToSend" to q.enterToSend, "newInquiry" to q.newInquiry, "aiFinished" to q.aiFinished, "teamActivity" to q.teamActivity)) {
            if (v == null) add(FieldProblem(f, "required"))
        }
    }

    private fun MutableList<FieldProblem>.pick(field: String, v: String?, allowed: Set<String>) {
        if (v == null) add(FieldProblem(field, "required")) else if (v !in allowed) add(FieldProblem(field, "invalid"))
    }

    companion object {
        const val DEFAULT_DATE_FORMAT = "MM/DD/YYYY"
        val DATE_FORMATS = mapOf("MM/DD/YYYY" to "MM/dd/yyyy", "DD/MM/YYYY" to "dd/MM/yyyy", "YYYY-MM-DD" to "yyyy-MM-dd")
        val START_PAGES = setOf("dashboard", "gallery", "upload", "inquiries")
        const val NEVER = "never"
        const val REALTIME = "realtime"
        val DIGESTS = setOf(REALTIME, "hourly", "daily", "weekly", NEVER)

        fun view(p: Prefs?): PreferencesView =
            if (p == null) PreferencesView(null, DEFAULT_DATE_FORMAT, "dashboard", false, true, true, true, false, false, false, NEVER, 0)
            else PreferencesView(p.timezone, p.dateFormat, p.startPage, p.enterToSend, p.newInquiry, p.aiFinished, p.teamActivity, p.emailNewInquiry, p.emailAiFinished, p.emailTeamActivity, p.digest, p.rev)

        fun dateFormatter(p: Prefs?): DateTimeFormatter =
            DateTimeFormatter.ofPattern(DATE_FORMATS[p?.dateFormat] ?: DATE_FORMATS.getValue(DEFAULT_DATE_FORMAT))
                .withZone(p?.timezone?.let(ZoneId::of) ?: ZoneOffset.UTC)
    }
}
