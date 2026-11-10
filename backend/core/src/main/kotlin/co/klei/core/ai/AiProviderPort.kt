package co.klei.core.ai

import java.util.UUID

/** The stored value is the lowercase name: test, embed, describe, chat, verify. */
enum class AiPurpose { TEST, EMBED, DESCRIBE, CHAT, VERIFY }

/** The stored value is the lowercase name: ok, error, timeout, refused. */
enum class AiOutcome { OK, ERROR, TIMEOUT, REFUSED }

/** Fixed cause strings. Provider text never reaches a client or a log. */
enum class AiFailure(val detail: String, val outcome: AiOutcome) {
    NOT_CONFIGURED("Not configured", AiOutcome.ERROR),
    REFUSED("Address not allowed", AiOutcome.REFUSED),
    UNAUTHORIZED("Unauthorized", AiOutcome.ERROR),
    TIMED_OUT("Timed out", AiOutcome.TIMEOUT),
    UNREACHABLE("Unreachable", AiOutcome.ERROR),
    HTTP_ERROR("Provider error", AiOutcome.ERROR),
    BAD_RESPONSE("Unexpected response", AiOutcome.ERROR),
    TOO_LARGE("Response too large", AiOutcome.ERROR),
}

/** [detail] is always built from [failure] and a status number, never from provider text. */
class AiProviderException(val failure: AiFailure, val detail: String = failure.detail, val retry: Boolean = false) :
    RuntimeException(failure.name, null, false, false)

/** [label] is what the usage log shows as the prompt; never user text or image bytes. Null keeps the adapter's fixed label. */
class AiCall(val purpose: AiPurpose, val userId: UUID?, val label: String? = null)

/**
 * The only way the backend reaches an AI provider (AD-12). Settings are read per call; a call must not run inside a DB
 * transaction; every call, failed ones included, leaves one `ai_usage` row.
 */
interface AiProviderPort {
    fun listModels(call: AiCall): List<String>

    /** Same call for an address and key not yet saved (the settings form). Nothing is stored. */
    fun listModels(call: AiCall, baseUrl: String, apiKey: String?, organization: String?): List<String>

    /** The embedding vector of one image. An empty vector is returned as is; the caller decides what it means. */
    fun embed(call: AiCall, image: ByteArray, mime: String): FloatArray

    /**
     * Name, Taxonomy values and description of one gown from its thumbnails (FR-9). [taxonomy] maps a type code to its
     * allowed values; [tone] is `warm`, `editorial` or `factual`. The answer is the provider's own text: the caller maps it.
     */
    fun describe(call: AiCall, images: List<DescribeImage>, taxonomy: Map<String, List<String>>, tone: String): Described

    /**
     * Which of [images] show the same gown (Story 10.3): a partition of their indexes, every index once, each part ascending
     * and parts ordered by their first index. A reply that is not such a partition is a [AiFailure.BAD_RESPONSE].
     */
    fun compare(call: AiCall, images: List<DescribeImage>): List<List<Int>>

    /** The assistant's answer to [messages] (FR-25); plain text. A blank answer is a [AiFailure.BAD_RESPONSE]. */
    fun chat(call: AiCall, messages: List<ChatTurn>): String
}

/** [role] is `system`, `user` or `assistant`. */
class ChatTurn(val role: String, val content: String)

class DescribeImage(val bytes: ByteArray, val mime: String)

/** [attributes] maps a type code to the values the provider named for it, unchecked. */
class Described(val name: String, val attributes: Map<String, List<String>>, val description: String)
