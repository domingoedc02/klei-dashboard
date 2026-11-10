package co.klei.app.ai

import co.klei.core.ai.AiOutcome
import co.klei.core.ai.AiPurpose
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import org.hibernate.annotations.OptimisticLock
import java.time.Instant
import java.util.UUID

/** Stored as `not_tested`, `connected`, `failed`. "Testing" exists only in the screen. */
enum class AiStatus { NOT_TESTED, CONNECTED, FAILED }

/** Description tone (FR-38). Stored lower case: `warm`, `editorial`, `factual`. */
enum class AiTone { WARM, EDITORIAL, FACTUAL }

/**
 * The one provider configuration (FR-37). `api_key` is write-only: no endpoint returns it. The test outcome columns are
 * outside the version, so a Test connection never turns the Admin's open form into a 409.
 */
@Entity
@Table(name = "ai_setting")
@EncryptedEntity("ai_setting")
class AiSetting(
    @Id val id: UUID,
    preset: String,
    baseUrl: String,
    embeddingModel: String,
    temperature: String,
    maxTokens: Int,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("preset") var preset: String = preset
    @Transient @Encrypted("base_url") var baseUrl: String = baseUrl
    @Transient @Encrypted("api_key") var apiKey: String? = null
    @Transient @Encrypted("organization") var organization: String? = null
    @Transient @Encrypted("chat_model") var chatModel: String? = null
    @Transient @Encrypted("vision_model") var visionModel: String? = null
    @Transient @Encrypted("embedding_model") var embeddingModel: String = embeddingModel
    /** Text like "0.7": the codec has no floating point type. */
    @Transient @Encrypted("temperature") var temperature: String = temperature
    @Transient @Encrypted("max_tokens") var maxTokens: Int = maxTokens
    @Transient @Encrypted("vision_model_adv") var visionModelAdv: String? = null
    /** Separate embeddings provider; both null = embeddings go to [baseUrl] with [apiKey]. */
    @Transient @Encrypted("embedding_base_url") var embeddingBaseUrl: String? = null
    @Transient @Encrypted("embedding_api_key") var embeddingApiKey: String? = null
    /** Grouping 1 (very loose) to 5 (very strict); null until first saved with it, the view then shows 3. */
    @Transient @Encrypted("sensitivity") var sensitivity: Int? = null
    @Transient @Encrypted("tone") var tone: AiTone? = null
    @Transient @Encrypted("advanced") var advanced: Boolean? = null
    @Transient @Encrypted("status") var status: AiStatus = AiStatus.NOT_TESTED
    @Transient @Encrypted("tested_at") var testedAt: Instant? = null
    /** Model ids from the last good Test connection, one per line. */
    @Transient @Encrypted("models") var models: String? = null

    internal var presetCt: ByteArray? = null
    internal var baseUrlCt: ByteArray? = null
    internal var apiKeyCt: ByteArray? = null
    internal var organizationCt: ByteArray? = null
    internal var chatModelCt: ByteArray? = null
    internal var visionModelCt: ByteArray? = null
    internal var embeddingModelCt: ByteArray? = null
    internal var temperatureCt: ByteArray? = null
    internal var maxTokensCt: ByteArray? = null
    internal var visionModelAdvCt: ByteArray? = null
    internal var embeddingBaseUrlCt: ByteArray? = null
    internal var embeddingApiKeyCt: ByteArray? = null
    internal var sensitivityCt: ByteArray? = null
    internal var toneCt: ByteArray? = null
    internal var advancedCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) internal var statusCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) internal var testedAtCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) internal var modelsCt: ByteArray? = null
}

/** One row per AI call, failures included (AD-13). `seq` is the plaintext ordering key (OQ-2), filled by the database. */
@Entity
@Table(name = "ai_usage")
@EncryptedEntity("ai_usage")
class AiUsage(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID?,
    purpose: AiPurpose,
    outcome: AiOutcome,
    duration: Long,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Transient @Encrypted("purpose") var purpose: AiPurpose = purpose
    @Transient @Encrypted("model") var model: String? = null
    @Transient @Encrypted("size") var size: Long? = null
    @Transient @Encrypted("outcome") var outcome: AiOutcome = outcome
    @Transient @Encrypted("duration") var duration: Long = duration
    @Transient @Encrypted("prompt") var prompt: String? = null
    @Transient @Encrypted("response") var response: String? = null
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    internal var purposeCt: ByteArray? = null
    internal var modelCt: ByteArray? = null
    internal var sizeCt: ByteArray? = null
    internal var outcomeCt: ByteArray? = null
    internal var durationCt: ByteArray? = null
    internal var promptCt: ByteArray? = null
    internal var responseCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null

    @Column(name = "seq", insertable = false, updatable = false) internal var seq: Long? = null
}
