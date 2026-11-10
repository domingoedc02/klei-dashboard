package co.klei.app.ai

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayInputStream
import java.net.InetSocketAddress
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import javax.imageio.ImageIO

/** An OpenAI-compatible provider on loopback. [mode] picks the answer; every request is recorded as `METHOD path | Authorization | body`. */
class StubProvider(private val modelIds: List<String> = listOf("dinov2-base", "chat-sentinel"), private val errorText: String = "PROVIDER-SECRET-TEXT") : AutoCloseable {
    enum class Mode { OK, UNAUTHORIZED, EMPTY_VECTOR, SERVER_ERROR }

    @Volatile var mode = Mode.OK

    /** The vector for the image a request carries; the default ignores the image. */
    @Volatile var vectorOf: (ByteArray) -> FloatArray = { floatArrayOf(0.25f, 0.5f, 0.75f) }

    /** Embedding requests left before every further one answers 401; lets a test stop a run half way. */
    val embedsLeft = AtomicInteger(Int.MAX_VALUE)
    @Volatile var delayMs = 0L

    /** The answer text of a chat request (gets the request body); the default names two allowed values. */
    @Volatile var chatAnswer: (String) -> String = DEFAULT_ANSWER

    /** Chat requests left before every further one answers 500; lets a test fail one group. Verify requests are not counted. */
    val chatsLeft = AtomicInteger(Int.MAX_VALUE)

    /** The answer text of a verify request (Story 10.3); the default says all photos show one gown. */
    @Volatile var verifyAnswer: (String) -> String = ONE_GOWN

    /** Verify requests left before every further one answers 500. */
    val verifiesLeft = AtomicInteger(Int.MAX_VALUE)

    /** The mean colour as a 3-value vector: solid test images of one colour land together, other colours apart. */
    object MeanColour : (ByteArray) -> FloatArray {
        override fun invoke(image: ByteArray): FloatArray {
            val img = ImageIO.read(ByteArrayInputStream(image))
            var r = 0L; var g = 0L; var b = 0L
            for (x in 0 until img.width) for (y in 0 until img.height) img.getRGB(x, y).let { r += (it shr 16) and 255; g += (it shr 8) and 255; b += it and 255 }
            val n = (img.width * img.height).toFloat()
            return floatArrayOf(r / n, g / n, b / n)
        }
    }
    val seen = CopyOnWriteArrayList<String>()

    companion object {
        const val VERIFY_MARK = "Which of these photos show the same gown?"

        /** One list holding every photo of the request. */
        val ONE_GOWN: (String) -> String = { b -> """{"groups":[[${(1..Regex(""""type":"image_url"""").findAll(b).count()).joinToString(",")}]]}""" }

        val DEFAULT_ANSWER: (String) -> String = {
            "{\"name\":\"Rose Lace\",\"attributes\":{\"silhouette\":[\"A-line\"],\"fabric\":[\"Lace\"]},\"description\":\"A soft lace gown.\"}"
        }
    }
    private val server = HttpServer.create(InetSocketAddress(0), 0).apply {
        createContext("/") { x -> handle(x) }
        start()
    }
    val port get() = server.address.port
    fun baseUrl(prefix: String = "") = "http://127.0.0.1:$port$prefix/v1"
    val baseUrl get() = baseUrl()

    private fun handle(x: HttpExchange) {
        val body = x.requestBody.readAllBytes().toString(Charsets.UTF_8)
        seen += "${x.requestMethod} ${x.requestURI.path} | ${x.requestHeaders.getFirst("Authorization")} | $body"
        val embedding = x.requestMethod == "POST" && x.requestURI.path.endsWith("/embeddings")
        if (embedding && delayMs > 0) Thread.sleep(delayMs)
        val exhausted = embedding && embedsLeft.getAndDecrement() <= 0
        val chat = x.requestMethod == "POST" && x.requestURI.path.endsWith("/chat/completions")
        val verify = chat && body.contains(VERIFY_MARK)
        val verifyFailed = verify && verifiesLeft.getAndDecrement() <= 0
        val chatFailed = chat && !verify && chatsLeft.getAndDecrement() <= 0
        val (status, json) = when {
            chatFailed || verifyFailed -> 500 to """{"error":"$errorText"}"""
            mode == Mode.UNAUTHORIZED || exhausted -> 401 to """{"error":{"message":"bad key $errorText"}}"""
            mode == Mode.SERVER_ERROR -> 500 to """{"error":"$errorText"}"""
            x.requestMethod == "GET" && x.requestURI.path.endsWith("/models") -> 200 to """{"data":[${modelIds.joinToString(",") { """{"id":"$it"}""" }}]}"""
            x.requestMethod == "POST" && x.requestURI.path.endsWith("/embeddings") ->
                200 to if (mode == Mode.EMPTY_VECTOR) """{"data":[{"embedding":[]}]}""" else """{"data":[{"embedding":[${vectorFor(body).joinToString(",")}]}]}"""
            chat -> 200 to JsonObject(mapOf("choices" to JsonArray(listOf(JsonObject(mapOf("message" to JsonObject(mapOf("content" to JsonPrimitive(if (verify) verifyAnswer(body) else chatAnswer(body)))))))))).toString()
            else -> 404 to "{}"
        }
        val bytes = json.toByteArray()
        x.responseHeaders.add("Content-Type", "application/json")
        x.sendResponseHeaders(status, bytes.size.toLong())
        x.responseBody.use { it.write(bytes) }
    }

    private fun vectorFor(body: String): FloatArray {
        val b64 = Regex("base64,([A-Za-z0-9+/=]+)").find(body)?.groupValues?.get(1) ?: return vectorOf(ByteArray(0))
        return vectorOf(Base64.getDecoder().decode(b64))
    }

    override fun close() = server.stop(0)
}
