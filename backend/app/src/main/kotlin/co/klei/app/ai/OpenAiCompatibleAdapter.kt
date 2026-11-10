package co.klei.app.ai

import co.klei.core.ai.AiCall
import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiOutcome
import co.klei.core.ai.AiProviderException
import co.klei.core.ai.AiProviderPort
import co.klei.core.ai.ChatTurn
import co.klei.core.ai.DescribeImage
import co.klei.core.ai.Described
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.apache.hc.client5.http.ConnectTimeoutException
import org.apache.hc.client5.http.DnsResolver
import org.apache.hc.client5.http.config.ConnectionConfig
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.core5.http.ClassicHttpRequest
import org.apache.hc.core5.http.ConnectionRequestTimeoutException
import org.apache.hc.core5.http.ContentType
import org.apache.hc.core5.http.io.entity.StringEntity
import org.apache.hc.core5.http.io.support.ClassicRequestBuilder
import org.apache.hc.core5.util.Timeout
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.io.IOException
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.Base64

/**
 * The one OpenAI-compatible adapter (AD-12, AD-13). Per attempt: SSRF check, then a client whose DNS answer is the
 * checked address only (the URL keeps its host, so SNI, certificate and Host header are the provider's own), no
 * redirects, a size cap, fixed error strings. Provider text is parsed, never echoed or logged.
 */
@Component
class OpenAiCompatibleAdapter(
    private val settings: AiSettingService,
    private val guard: SsrfGuard,
    private val usage: AiUsageRecorder,
) : AiProviderPort {
    private val log = LoggerFactory.getLogger(OpenAiCompatibleAdapter::class.java)

    override fun listModels(call: AiCall): List<String> = models(call, null)

    override fun listModels(call: AiCall, baseUrl: String, apiKey: String?, organization: String?): List<String> =
        models(call, AiConfig(0, baseUrl, apiKey, organization, null, "", null, null, false, 0.0, 0))

    private fun models(call: AiCall, draft: AiConfig?): List<String> =
        exec(call, "GET /models", null, { null }, draft) { cfg, target ->
            val body = send(cfg, ClassicRequestBuilder.get(join(target, "/models")), target.address)
            val ids = try {
                Json.parseToJsonElement(body).jsonObject["data"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
            } catch (e: Exception) {
                throw AiProviderException(AiFailure.BAD_RESPONSE)
            }
            ids to "${ids.size} models"
        }

    override fun embed(call: AiCall, image: ByteArray, mime: String): FloatArray =
        exec(call, call.label ?: "POST embeddings", image.size.toLong(), { it.embeddingModel }, embedding = true) { cfg, target ->
            val uri = target.uri.path.trimEnd('/')
            val path = if (uri.endsWith("/v1")) "/embeddings" else "/v1/embeddings"
            val input = "data:$mime;base64," + Base64.getEncoder().encodeToString(image) // spike S-1: data URI as `input`
            val payload = JsonObject(mapOf("model" to JsonPrimitive(cfg.embeddingModel), "input" to JsonPrimitive(input))).toString()
            val body = send(cfg, ClassicRequestBuilder.post(join(target, path)).setEntity(StringEntity(payload, ContentType.APPLICATION_JSON)), target.address)
            val vector = try {
                val v = Json.parseToJsonElement(body).jsonObject["data"]!!.jsonArray[0].jsonObject["embedding"]!!.jsonArray
                FloatArray(v.size) { v[it].jsonPrimitive.floatOrNull ?: throw IllegalArgumentException() }
            } catch (e: Exception) {
                throw AiProviderException(AiFailure.BAD_RESPONSE)
            }
            vector to "dimension ${vector.size}"
        }

    override fun describe(call: AiCall, images: List<DescribeImage>, taxonomy: Map<String, List<String>>, tone: String): Described =
        exec(call, call.label ?: "POST chat/completions", images.sumOf { it.bytes.size }.toLong(), { it.describeModel }) { cfg, target ->
            val model = cfg.describeModel ?: throw AiProviderException(AiFailure.NOT_CONFIGURED)
            val path = completionsPath(target)
            val parts = imageParts(images)
            val payload = JsonObject(
                mapOf(
                    "model" to JsonPrimitive(model),
                    "temperature" to JsonPrimitive(cfg.temperature),
                    "max_tokens" to JsonPrimitive(cfg.maxTokens),
                    "messages" to JsonArray(
                        listOf(
                            JsonObject(mapOf("role" to JsonPrimitive("system"), "content" to JsonPrimitive(PromptBuilder.system(tone, taxonomy)))),
                            JsonObject(mapOf("role" to JsonPrimitive("user"), "content" to JsonArray(listOf(textPart("Describe this gown.")) + parts))),
                        ),
                    ),
                ),
            ).toString()
            val body = send(cfg, ClassicRequestBuilder.post(join(target, path)).setEntity(StringEntity(payload, ContentType.APPLICATION_JSON)), target.address)
            val answer = PromptBuilder.parseCompletion(body)
            answer to "${images.size} photos"
        }

    override fun compare(call: AiCall, images: List<DescribeImage>): List<List<Int>> =
        exec(call, call.label ?: "POST chat/completions", images.sumOf { it.bytes.size }.toLong(), { it.describeModel }) { cfg, target ->
            val model = cfg.describeModel ?: throw AiProviderException(AiFailure.NOT_CONFIGURED)
            val payload = JsonObject(
                mapOf(
                    "model" to JsonPrimitive(model),
                    "temperature" to JsonPrimitive(0),
                    "max_tokens" to JsonPrimitive(cfg.maxTokens),
                    "messages" to JsonArray(
                        listOf(
                            JsonObject(mapOf("role" to JsonPrimitive("system"), "content" to JsonPrimitive(PromptBuilder.verifySystem()))),
                            JsonObject(mapOf("role" to JsonPrimitive("user"), "content" to JsonArray(listOf(textPart("Which of these photos show the same gown?")) + imageParts(images)))),
                        ),
                    ),
                ),
            ).toString()
            val body = send(cfg, ClassicRequestBuilder.post(join(target, completionsPath(target))).setEntity(StringEntity(payload, ContentType.APPLICATION_JSON)), target.address)
            val parts = PromptBuilder.parsePartition(body, images.size)
            parts to "${images.size} photos, ${parts.size} gowns"
        }

    override fun chat(call: AiCall, messages: List<ChatTurn>): String =
        exec(call, call.label ?: "POST chat/completions", messages.sumOf { it.content.length }.toLong(), { it.chatModel }) { cfg, target ->
            val model = cfg.chatModel?.takeIf { it.isNotBlank() } ?: throw AiProviderException(AiFailure.NOT_CONFIGURED)
            val payload = JsonObject(
                mapOf(
                    "model" to JsonPrimitive(model),
                    "temperature" to JsonPrimitive(cfg.temperature),
                    "max_tokens" to JsonPrimitive(cfg.maxTokens),
                    "messages" to JsonArray(messages.map { JsonObject(mapOf("role" to JsonPrimitive(it.role), "content" to JsonPrimitive(it.content))) }),
                ),
            ).toString()
            val body = send(cfg, ClassicRequestBuilder.post(join(target, completionsPath(target))).setEntity(StringEntity(payload, ContentType.APPLICATION_JSON)), target.address)
            val text = try {
                Json.parseToJsonElement(body).jsonObject["choices"]!!.jsonArray[0].jsonObject["message"]!!.jsonObject["content"]!!.jsonPrimitive.content
            } catch (e: Exception) {
                throw AiProviderException(AiFailure.BAD_RESPONSE)
            }
            if (text.isBlank()) throw AiProviderException(AiFailure.BAD_RESPONSE)
            text to "${messages.size} messages"
        }

    private fun completionsPath(target: SsrfGuard.Target) = if (target.uri.path.trimEnd('/').endsWith("/v1")) "/chat/completions" else "/v1/chat/completions"

    private fun imageParts(images: List<DescribeImage>) = images.flatMapIndexed { i, img ->
        listOf(
            textPart(PromptBuilder.photoLabel(i + 1, images.size)),
            JsonObject(mapOf("type" to JsonPrimitive("image_url"), "image_url" to JsonObject(mapOf("url" to JsonPrimitive("data:${img.mime};base64," + Base64.getEncoder().encodeToString(img.bytes)))))),
        )
    }

    private fun textPart(text: String) = JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(text)))

    /** Runs one call and leaves exactly one usage row, whatever happens. */
    private fun <R> exec(call: AiCall, label: String, size: Long?, model: (AiConfig) -> String?, draft: AiConfig? = null, embedding: Boolean = false, op: (AiConfig, SsrfGuard.Target) -> Pair<R, String>): R {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "AI call inside a transaction" }
        val started = System.nanoTime()
        var cfg: AiConfig? = null
        try {
            cfg = (draft ?: settings.config()).let { if (embedding) it.forEmbedding else it }
            var attempt = 0
            while (true) {
                try {
                    val (value, summary) = op(cfg, guard.check(cfg.baseUrl))
                    record(call, cfg, model, size, AiOutcome.OK, started, label, summary)
                    return value
                } catch (e: AiProviderException) {
                    // shortcut: a read timeout is not retried (it would double a 60 s wait), upgrade when providers prove flaky.
                    if (e.retry && attempt++ == 0) continue
                    throw e
                }
            }
        } catch (e: AiProviderException) {
            record(call, cfg, model, size, e.failure.outcome, started, label, e.detail)
            throw e
        }
    }

    private fun record(call: AiCall, cfg: AiConfig?, model: (AiConfig) -> String?, size: Long?, outcome: AiOutcome, started: Long, label: String, summary: String) {
        try {
            usage.record(call, cfg?.let(model), size, outcome, (System.nanoTime() - started) / 1_000_000, label, summary)
        } catch (e: Exception) {
            log.error("ai usage not recorded {}", e.javaClass.name)
        }
    }

    private fun join(target: SsrfGuard.Target, path: String): String {
        val u = target.uri
        return u.scheme + "://" + (if (u.host.contains(':')) "[${u.host}]" else u.host) + (if (u.port >= 0) ":${u.port}" else "") + u.rawPath.trimEnd('/') + path
    }

    private fun send(cfg: AiConfig, builder: ClassicRequestBuilder, address: InetAddress): String {
        cfg.apiKey?.let { builder.addHeader("Authorization", "Bearer $it") }
        cfg.organization?.let { builder.addHeader("OpenAI-Organization", it) }
        builder.addHeader("Accept", "application/json")
        val request: ClassicHttpRequest = builder.build()
        val resolver = object : DnsResolver {
            override fun resolve(host: String?): Array<InetAddress> = arrayOf(address)
            override fun resolveCanonicalHostname(host: String?): String? = host
        }
        val connections = PoolingHttpClientConnectionManagerBuilder.create()
            .setDnsResolver(resolver)
            .setDefaultConnectionConfig(ConnectionConfig.custom().setConnectTimeout(Timeout.ofSeconds(10)).setSocketTimeout(Timeout.ofSeconds(TIMEOUT_SECONDS)).build())
            .build()
        try {
            HttpClients.custom().setConnectionManager(connections).disableRedirectHandling().disableAutomaticRetries()
                .setDefaultRequestConfig(RequestConfig.custom().setResponseTimeout(Timeout.ofSeconds(TIMEOUT_SECONDS)).build())
                .setProxy(null).disableCookieManagement().build().use { client ->
                    return client.execute(request) { response ->
                        val code = response.code
                        if (code !in 200..299) log.warn("ai provider answered http {}", code) // status only: provider text is never logged
                        when {
                            code in 200..299 -> Unit
                            code == 401 || code == 403 -> throw AiProviderException(AiFailure.UNAUTHORIZED)
                            code == 429 || code >= 500 -> throw AiProviderException(AiFailure.HTTP_ERROR, "Provider error $code", retry = true)
                            else -> throw AiProviderException(AiFailure.HTTP_ERROR, "Provider error $code")
                        }
                        val bytes = response.entity?.content?.use { it.readNBytes(MAX_BODY + 1) } ?: ByteArray(0)
                        if (bytes.size > MAX_BODY) throw AiProviderException(AiFailure.TOO_LARGE)
                        String(bytes, Charsets.UTF_8)
                    }
                }
        } catch (e: AiProviderException) {
            throw e
        } catch (e: SocketTimeoutException) {
            throw AiProviderException(AiFailure.TIMED_OUT)
        } catch (e: ConnectTimeoutException) {
            throw AiProviderException(AiFailure.TIMED_OUT)
        } catch (e: ConnectionRequestTimeoutException) {
            throw AiProviderException(AiFailure.TIMED_OUT)
        } catch (e: IOException) {
            throw AiProviderException(AiFailure.UNREACHABLE, retry = true)
        } finally {
            connections.close()
        }
    }

    companion object {
        const val TIMEOUT_SECONDS = 60L
        const val MAX_BODY = 4 * 1024 * 1024
    }
}
