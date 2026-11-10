package co.klei.app.ai

import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import co.klei.core.ai.Described
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The text a describe call sends and the reader of its answer. Photos are only ever "Photo n"; no name, id or path (NFR-1). */
object PromptBuilder {
    private val TONES = mapOf(
        "warm" to "Write the description in a warm, inviting voice, as a bridal consultant would speak to a bride.",
        "editorial" to "Write the description in an elegant editorial voice, as a fashion magazine would.",
        "factual" to "Write the description in a plain factual voice: construction, fabric and silhouette, no flourish.",
    )

    fun system(tone: String, taxonomy: Map<String, List<String>>): String = buildString {
        append("You catalogue bridal gowns for a studio. The photos show one gown from several angles. ")
        append(TONES[tone] ?: TONES.getValue("warm")).append(' ')
        append("Reply with one JSON object only: {\"name\": short gown name of at most 5 words, \"attributes\": {")
        append(taxonomy.keys.joinToString(", ") { "\"$it\": [values]" })
        append("}, \"description\": two or three sentences}. Use only these attribute values, copied exactly; leave a list empty when none fits:\n")
        taxonomy.forEach { (type, values) -> append("- ").append(type).append(": ").append(values.joinToString(", ")).append('\n') }
    }

    fun photoLabel(n: Int, of: Int) = "Photo $n of $of"

    /** Asks which photos of a Group show one gown; the answer is read by [parsePartition]. Photos are only "Photo n of m". */
    fun verifySystem(): String =
        "You check a bridal studio's photo grouping. The photos below were grouped as one gown, but some may show a different gown. " +
            "Decide which photos show the same bridal gown, whatever the angle, pose, light or crop. " +
            "Reply with one JSON object only: {\"groups\": [[photo numbers of one gown], ...]}. " +
            "Use each photo number exactly once; when all photos show one gown, reply with a single list."

    /** Reads `choices[0].message.content` and the JSON object inside it; code fences and chatter around it are tolerated. */
    fun parseCompletion(body: String): Described = parseAnswer(content(body))

    private fun content(body: String): String = try {
        Json.parseToJsonElement(body).jsonObject["choices"]!!.let { it as JsonArray }[0].jsonObject["message"]!!.jsonObject["content"]!!.jsonPrimitive.content
    } catch (e: Exception) {
        throw AiProviderException(AiFailure.BAD_RESPONSE)
    }

    private fun json(content: String): JsonObject {
        val from = content.indexOf('{')
        val to = content.lastIndexOf('}')
        if (from < 0 || to <= from) throw AiProviderException(AiFailure.BAD_RESPONSE)
        return try {
            Json.parseToJsonElement(content.substring(from, to + 1)).jsonObject
        } catch (e: Exception) {
            throw AiProviderException(AiFailure.BAD_RESPONSE)
        }
    }

    /** The groups of "Photo 1..[n]" the answer names, as ascending 0-based indexes ordered by first index; anything but each photo exactly once is a bad response. */
    fun parsePartition(body: String, n: Int): List<List<Int>> {
        val parts = try {
            json(content(body))["groups"]!!.let { it as JsonArray }.map { g -> (g as JsonArray).map { it.jsonPrimitive.content.toInt() - 1 } }
        } catch (e: AiProviderException) {
            throw e
        } catch (e: Exception) {
            throw AiProviderException(AiFailure.BAD_RESPONSE)
        }
        val all = parts.flatten()
        if (parts.any { it.isEmpty() } || all.sorted() != (0 until n).toList()) throw AiProviderException(AiFailure.BAD_RESPONSE)
        return parts.map { it.sorted() }.sortedBy { it.first() }
    }

    fun parseAnswer(content: String): Described {
        val o = json(content)
        val attrs = (o["attributes"] as? JsonObject)?.entries?.associate { (k, v) ->
            k.lowercase() to when (v) {
                is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                is JsonPrimitive -> listOfNotNull(v.contentOrNull)
                else -> emptyList()
            }
        }.orEmpty()
        return Described((o["name"] as? JsonPrimitive)?.contentOrNull.orEmpty(), attrs, (o["description"] as? JsonPrimitive)?.contentOrNull.orEmpty())
    }
}
