package co.klei.app.ai

import co.klei.app.web.FieldProblem
import java.net.URI

/** Body of `PUT /api/v1/admin/ai`. `apiKey` absent keeps the stored key; it is never echoed anywhere. */
class AiSettingsRequest {
    var preset: String? = null
    var baseUrl: String? = null
    var apiKey: String? = null
    var organization: String? = null
    var chatModel: String? = null
    var visionModel: String? = null
    var embeddingModel: String? = null
    /** Optional separate embeddings provider. Blank or absent = embeddings use the main address. The key follows the main key's rules. */
    var embeddingBaseUrl: String? = null
    var embeddingApiKey: String? = null
    var temperature: Double? = null
    var maxTokens: Int? = null
    /** Cleared when null, like the other model names. */
    var visionModelAdv: String? = null
    /** The three below keep the stored value when absent (a first save uses 3, `warm`, off). */
    var sensitivity: Int? = null
    var tone: String? = null
    var advanced: Boolean? = null
}

/** Body of `POST /api/v1/admin/ai/models`. Same key rule as the save: absent keeps the stored key, for the stored host only. */
class AiModelsRequest {
    var baseUrl: String? = null
    var apiKey: String? = null
    /** True when the address is the embeddings provider: its stored key is the one to reuse. */
    var embedding: Boolean? = null
}

/** [failure] is a fixed cause string (never provider text), or null when [models] was read. */
data class AiModelsResult(val models: List<String>, val failure: String?)

/** What one provider call needs. [toString] hides everything: this object holds the key. */
class AiConfig(
    val version: Long,
    val baseUrl: String,
    val apiKey: String?,
    val organization: String?,
    val chatModel: String?,
    val embeddingModel: String,
    val visionModel: String?,
    val visionModelAdv: String?,
    val advanced: Boolean,
    val temperature: Double,
    val maxTokens: Int,
    val embeddingBaseUrl: String? = null,
    val embeddingApiKey: String? = null,
) {
    /**
     * What an embeddings call uses: the separate provider when one is set, else this. The main key and organization go to
     * the separate address only when it is the same origin; otherwise it gets its own key or none.
     */
    val forEmbedding: AiConfig
        get() {
            val url = embeddingBaseUrl ?: return this
            val same = AiSettingsRules.origin(url) == AiSettingsRules.origin(baseUrl)
            return AiConfig(version, url, embeddingApiKey ?: apiKey.takeIf { same }, organization.takeIf { same }, chatModel, embeddingModel, visionModel, visionModelAdv, advanced, temperature, maxTokens)
        }

    /** The advanced model when the switch is on and one is set, else the standard vision model. */
    val describeModel: String? get() = if (advanced && !visionModelAdv.isNullOrBlank()) visionModelAdv else visionModel?.takeIf { it.isNotBlank() }

    override fun toString() = "AiConfig"
}

/** Field rules for the settings form. Codes are fixed strings; the submitted value is never part of a problem. */
object AiSettingsRules {
    val PRESETS = setOf("litellm", "openai", "openrouter", "groq", "ollama", "custom")
    val TONES = AiTone.entries.map { it.name.lowercase() }.toSet()
    const val OLLAMA = "ollama"
    private const val MAX_URL = 2000
    private const val MAX_TEXT = 200
    private const val MAX_KEY = 500

    fun check(r: AiSettingsRequest): List<FieldProblem> {
        val out = mutableListOf<FieldProblem>()
        fun bad(field: String, code: String) { out += FieldProblem(field, code) }
        if (r.preset !in PRESETS) bad("preset", "invalid")
        val url = r.baseUrl
        when {
            url.isNullOrBlank() -> bad("baseUrl", "required")
            url.length > MAX_URL -> bad("baseUrl", "too_long")
            origin(url) == null -> bad("baseUrl", "invalid")
        }
        r.apiKey?.let { if (it.length > MAX_KEY) bad("apiKey", "too_long") else if (it.any { c -> c <= ' ' || c.code == 127 }) bad("apiKey", "invalid") }
        for ((field, v) in listOf("organization" to r.organization, "chatModel" to r.chatModel, "visionModel" to r.visionModel, "visionModelAdv" to r.visionModelAdv)) {
            if (v != null && (v.length > MAX_TEXT || v.any { it < ' ' || it.code == 127 })) bad(field, "invalid")
        }
        r.embeddingBaseUrl?.takeIf { it.isNotBlank() }?.let {
            if (it.length > MAX_URL) bad("embeddingBaseUrl", "too_long") else if (origin(it) == null) bad("embeddingBaseUrl", "invalid")
        }
        r.embeddingApiKey?.let { if (it.length > MAX_KEY) bad("embeddingApiKey", "too_long") else if (it.any { c -> c <= ' ' || c.code == 127 }) bad("embeddingApiKey", "invalid") }
        val embedding = r.embeddingModel
        if (embedding.isNullOrBlank()) bad("embeddingModel", "required")
        else if (embedding.length > MAX_TEXT || embedding.any { it < ' ' || it.code == 127 }) bad("embeddingModel", "invalid")
        val t = r.temperature
        if (t == null) bad("temperature", "required") else if (t.isNaN() || t < 0.0 || t > 2.0) bad("temperature", "out_of_range")
        val m = r.maxTokens
        if (m == null) bad("maxTokens", "required") else if (m < 64 || m > 8192) bad("maxTokens", "out_of_range")
        r.sensitivity?.let { if (it !in 1..5) bad("sensitivity", "out_of_range") }
        r.tone?.let { if (it !in TONES) bad("tone", "invalid") }
        return out
    }

    /** `scheme://host:port` in lower case, or null when [url] is not an http(s) URL we accept (no userinfo, query or fragment). */
    fun origin(url: String): String? = try {
        val u = URI(url.trim())
        val scheme = u.scheme?.lowercase()
        val host = u.host?.lowercase()
        if ((scheme != "http" && scheme != "https") || host.isNullOrEmpty() || u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) null
        else "$scheme://$host:${if (u.port >= 0) u.port else if (scheme == "https") 443 else 80}"
    } catch (e: Exception) {
        null
    }
}
