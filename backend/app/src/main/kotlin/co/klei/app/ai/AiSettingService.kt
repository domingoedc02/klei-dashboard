package co.klei.app.ai

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.app.web.FieldProblem
import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import co.klei.core.audit.AuditAction
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.time.Instant
import java.util.UUID

const val API_KEY_MASK = "••••••••"

/** What `GET /api/v1/admin/ai` returns. The key itself is not a field here; only whether one is stored. */
data class AiSettingsView(
    val preset: String,
    val baseUrl: String,
    val apiKeySet: Boolean,
    val apiKeyMask: String?,
    val organization: String?,
    val chatModel: String?,
    val visionModel: String?,
    val visionModelAdv: String?,
    val sensitivity: Int,
    val tone: String,
    val advanced: Boolean,
    val embeddingModel: String,
    val embeddingBaseUrl: String?,
    val embeddingApiKeySet: Boolean,
    val temperature: Double,
    val maxTokens: Int,
    val status: String,
    val testedAt: String?,
    val models: List<String>,
    val version: Long,
)

/** The one AI settings row (FR-37). Reads for provider calls go through [config] (60 s cache, cleared on save). */
@Service
class AiSettingService(private val em: EntityManager, private val users: UserService, private val audit: AuditService) {
    @Volatile private var cached: Pair<Long, AiConfig>? = null

    @Transactional(readOnly = true)
    fun view(): AiSettingsView = row()?.let(::toView) ?: DEFAULTS

    /** Never called inside a caller's transaction that also makes a provider call: it opens and closes its own read. */
    @Transactional(readOnly = true)
    fun config(): AiConfig {
        val hit = cached
        if (hit != null && System.nanoTime() - hit.first < CACHE_NANOS) return hit.second
        val r = row()
        if (r == null || r.baseUrl.isBlank()) throw AiProviderException(AiFailure.NOT_CONFIGURED)
        val cfg = AiConfig(
            apiVersion(r), r.baseUrl, r.apiKey, r.organization, r.chatModel, r.embeddingModel, r.visionModel, r.visionModelAdv,
            r.advanced ?: false, r.temperature.toDoubleOrNull() ?: 0.7, r.maxTokens, r.embeddingBaseUrl, r.embeddingApiKey,
        )
        cached = System.nanoTime() to cfg
        return cfg
    }

    @Transactional
    fun save(req: AiSettingsRequest, ifMatch: Long, by: UUID, ip: String?): AiSettingsView {
        val actor = users.get(by)?.name ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val r = em.find(AiSetting::class.java, ID, LockModeType.PESSIMISTIC_WRITE)
        if (ifMatch != (r?.let(::apiVersion) ?: 0L)) throw ProblemException(ProblemCode.CONFLICT)
        val preset = req.preset!!
        val baseUrl = req.baseUrl!!.trim()
        val newKey = req.apiKey?.takeIf { it.isNotEmpty() }
        val hostChanged = r != null && AiSettingsRules.origin(r.baseUrl) != AiSettingsRules.origin(baseUrl)
        val hasKey = newKey != null || r?.apiKey != null
        when {
            hostChanged && newKey == null -> throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("apiKey", "required_on_host_change")))
            !hasKey && preset != AiSettingsRules.OLLAMA -> throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("apiKey", "required")))
        }
        // The embeddings key never outlives its address: another address starts with no key unless one is typed.
        val embUrl = req.embeddingBaseUrl?.trim()?.ifEmpty { null }
        val embKeyTyped = req.embeddingApiKey?.takeIf { it.isNotEmpty() }
        val embHostChanged = r?.embeddingBaseUrl?.let(AiSettingsRules::origin) != embUrl?.let(AiSettingsRules::origin)
        val embSeparate = embUrl != null && AiSettingsRules.origin(embUrl) != AiSettingsRules.origin(baseUrl)
        val embKey = when {
            !embSeparate -> null // blank or the main address: the main key serves it
            embKeyTyped != null -> embKeyTyped
            embHostChanged -> null
            else -> r?.embeddingApiKey
        }
        if (embSeparate && embKey == null && preset != AiSettingsRules.OLLAMA) {
            throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("embeddingApiKey", if (embHostChanged && r?.embeddingBaseUrl != null) "required_on_host_change" else "required")))
        }
        val advModel = req.visionModelAdv?.trim()?.ifEmpty { null }
        val advanced = req.advanced ?: r?.advanced ?: false
        if (advanced && advModel == null) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("advanced", "needs_model")))
        val row = r ?: AiSetting(ID, preset, baseUrl, req.embeddingModel!!.trim(), "0.7", 1024).also { em.persist(it) }
        val changed = mutableListOf<String>()
        fun <T> set(name: String, old: T, new: T, apply: (T) -> Unit) { if (old != new) { apply(new); changed += name } }
        val org = req.organization?.trim()?.ifEmpty { null }
        set("preset", row.preset, preset) { row.preset = it }
        set("baseUrl", row.baseUrl, baseUrl) { row.baseUrl = it }
        if (newKey != null) set("apiKey", row.apiKey, newKey) { row.apiKey = it }
        set("organization", row.organization, org) { row.organization = it }
        set("chatModel", row.chatModel, req.chatModel?.trim()?.ifEmpty { null }) { row.chatModel = it }
        set("visionModel", row.visionModel, req.visionModel?.trim()?.ifEmpty { null }) { row.visionModel = it }
        set("visionModelAdv", row.visionModelAdv, advModel) { row.visionModelAdv = it }
        set("sensitivity", row.sensitivity ?: DEFAULT_SENSITIVITY, req.sensitivity ?: row.sensitivity ?: DEFAULT_SENSITIVITY) { row.sensitivity = it }
        set("tone", row.tone ?: AiTone.WARM, req.tone?.let { AiTone.valueOf(it.uppercase()) } ?: row.tone ?: AiTone.WARM) { row.tone = it }
        set("advanced", row.advanced ?: false, advanced) { row.advanced = it }
        set("embeddingBaseUrl", row.embeddingBaseUrl, embUrl) { row.embeddingBaseUrl = it }
        set("embeddingApiKey", row.embeddingApiKey, embKey) { row.embeddingApiKey = it }
        set("embeddingModel", row.embeddingModel, req.embeddingModel!!.trim()) { row.embeddingModel = it }
        set("temperature", row.temperature, req.temperature!!.toString()) { row.temperature = it }
        set("maxTokens", row.maxTokens, req.maxTokens!!) { row.maxTokens = it }
        // A different address or credential is a different provider: the old verdict and model list no longer apply.
        if (changed.any { it == "baseUrl" || it == "apiKey" || it == "organization" || it == "embeddingBaseUrl" || it == "embeddingApiKey" } && r != null) {
            row.status = AiStatus.NOT_TESTED
            row.testedAt = null
            row.models = null
        }
        em.flush()
        if (r != null && changed.isNotEmpty() || r == null) {
            audit.record(AuditAction.AI_SETTINGS_CHANGED, detail = "changed: ${changed.ifEmpty { listOf("created") }.joinToString(" ")}", actorId = by, actorName = actor, ip = ip)
        }
        dropCacheAfterCommit()
        return toView(row)
    }

    /**
     * The key and organization to try against [baseUrl] before saving: the typed key, else a stored one for the same host
     * (a key never travels to a host it was not saved for). [embedding] also tries the embeddings provider's own key first.
     * Own read; no provider call runs inside it.
     */
    @Transactional(readOnly = true)
    fun draftCredentials(baseUrl: String, typedKey: String?, embedding: Boolean = false): Pair<String?, String?> {
        val r = row()
        val o = AiSettingsRules.origin(baseUrl)
        val main = r != null && AiSettingsRules.origin(r.baseUrl) == o
        val emb = embedding && r?.embeddingBaseUrl?.let(AiSettingsRules::origin) == o
        val stored = (if (emb) r?.embeddingApiKey else null) ?: r?.apiKey.takeIf { main }
        return (typedKey?.takeIf { it.isNotEmpty() } ?: stored) to r?.organization?.takeIf { main }
    }

    /** Stores the verdict of one Test connection unless the settings were saved meanwhile (then the verdict is for old settings). */
    @Transactional
    fun recordTest(version: Long, status: AiStatus, models: List<String>?) {
        val r = em.find(AiSetting::class.java, ID) ?: return
        if (apiVersion(r) != version) return
        r.status = status
        r.testedAt = Instant.now()
        if (models != null) r.models = models.take(MAX_MODELS).joinToString("\n")
    }

    private fun row(): AiSetting? = em.find(AiSetting::class.java, ID)

    /** 0 means "no row yet", so two Admins who both opened the empty form cannot both create it. */
    private fun apiVersion(r: AiSetting) = (r.version ?: -1) + 1

    private fun dropCacheAfterCommit() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) { cached = null; return }
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() { cached = null }
        })
    }

    private fun toView(r: AiSetting) = AiSettingsView(
        r.preset, r.baseUrl, r.apiKey != null, if (r.apiKey != null) API_KEY_MASK else null, r.organization, r.chatModel, r.visionModel,
        r.visionModelAdv, r.sensitivity ?: DEFAULT_SENSITIVITY, (r.tone ?: AiTone.WARM).name.lowercase(), r.advanced ?: false, r.embeddingModel, r.embeddingBaseUrl, r.embeddingApiKey != null, r.temperature.toDoubleOrNull() ?: 0.7, r.maxTokens, r.status.name.lowercase(), r.testedAt?.toString(),
        r.models?.lines()?.filter { it.isNotBlank() } ?: emptyList(), apiVersion(r),
    )

    companion object {
        val ID: UUID = UUID.fromString("00000000-0000-4000-8000-0000000000a1")
        const val CACHE_NANOS = 60_000_000_000L
        const val MAX_MODELS = 500
        const val DEFAULT_SENSITIVITY = 3
        val DEFAULTS = AiSettingsView("litellm", "", false, null, null, null, null, null, DEFAULT_SENSITIVITY, "warm", false, "dinov2-base", null, false, 0.7, 1024, "not_tested", null, emptyList(), 0)
    }
}
