package co.klei.app.upload

import co.klei.core.storage.ListedObject
import co.klei.core.storage.ObjectStorePort
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpHeaders
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.CRC32
import javax.imageio.ImageIO

/** In-memory bucket for tests that look at what the app stores; [modified] lets a test age an object. */
class FakeStore : ObjectStorePort {
    val objects = ConcurrentHashMap<UUID, ByteArray>()
    val modified = ConcurrentHashMap<UUID, Instant>()
    override fun ensureBucket() {}
    override fun isReachable() = true
    override fun put(key: UUID, body: ByteArray) { objects[key] = body; modified[key] = Instant.now() }
    override fun get(key: UUID): ByteArray? = objects[key]
    @Volatile var failDeletes = false
    override fun delete(key: UUID) {
        check(!failDeletes) { "store down" }
        objects.remove(key); modified.remove(key)
    }
    override fun list(): List<ListedObject> = objects.keys.map { ListedObject(it.toString(), modified[it] ?: Instant.now()) }
}

/** Test images built in code, so no binary fixtures sit in the repository. */
object Images {
    private fun raster(w: Int, h: Int) = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB).also { img ->
        for (x in 0 until w) for (y in 0 until h) img.setRGB(x, y, ((x * 255 / w) shl 16) or ((y * 255 / h) shl 8) or 128)
    }

    private fun encode(format: String, w: Int, h: Int) = ByteArrayOutputStream().also { check(ImageIO.write(raster(w, h), format, it)) }.toByteArray()

    /** A JPEG; [comment] becomes a COM segment right after SOI, which is where a camera's free text would sit. */
    fun jpeg(w: Int = 64, h: Int = 48, comment: String? = null): ByteArray {
        val b = encode("jpeg", w, h)
        if (comment == null) return b
        val c = comment.toByteArray()
        val len = c.size + 2
        return b.copyOfRange(0, 2) + byteArrayOf(0xFF.toByte(), 0xFE.toByte(), (len shr 8).toByte(), len.toByte()) + c + b.copyOfRange(2, b.size)
    }

    /** One flat colour, so a stub that reads the mean colour sees a distinct "gown". */
    fun solid(r: Int, g: Int, b: Int, w: Int = 64, h: Int = 48): ByteArray {
        val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        for (x in 0 until w) for (y in 0 until h) img.setRGB(x, y, (r shl 16) or (g shl 8) or b)
        return ByteArrayOutputStream().also { check(ImageIO.write(img, "jpeg", it)) }.toByteArray()
    }

    fun png(w: Int = 64, h: Int = 48) = encode("png", w, h)

    /** 1x1 lossless WebP. */
    val WEBP: ByteArray = Base64.getDecoder().decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")

    /** Only signature, IHDR and IEND: claims [w] x [h] pixels without holding any. */
    fun pngHeaderOnly(w: Int, h: Int): ByteArray {
        fun chunk(type: String, data: ByteArray): ByteArray {
            val crc = CRC32().also { it.update(type.toByteArray()); it.update(data) }.value
            return ByteBuffer.allocate(12 + data.size).putInt(data.size).put(type.toByteArray()).put(data).putInt(crc.toInt()).array()
        }
        val ihdr = ByteBuffer.allocate(13).putInt(w).putInt(h).put(8).put(2).put(0).put(0).put(0).array()
        return byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + chunk("IHDR", ihdr) + chunk("IEND", ByteArray(0))
    }

    /** JPEG start bytes followed by markup: sniffs as a JPEG, decodes as nothing. */
    fun polyglot(): ByteArray = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + "<html><script>alert(1)</script></html>".toByteArray()
}

/** Raw HTTP for the upload routes: bodies are bytes, which `AuthWebClient.api` cannot carry. */
object UploadClient {
    class Resp(val status: Int, val body: ByteArray, val headers: HttpHeaders) {
        val text get() = String(body, Charsets.UTF_8)
        fun header(name: String): String? = headers.firstValue(name).orElse(null)
        fun id(): String = Regex(""""id":"([0-9a-f-]{36})"""").find(text)!!.groupValues[1]
    }

    private val http = HttpClient.newHttpClient()

    fun call(method: String, url: String, token: String?, body: ByteArray? = null, headers: Map<String, String> = emptyMap()): Resp {
        val b = HttpRequest.newBuilder(URI.create(url)).method(method, if (body == null) BodyPublishers.noBody() else BodyPublishers.ofByteArray(body))
        token?.let { b.header("Authorization", "Bearer $it") }
        headers.forEach { (k, v) -> b.header(k, v) }
        val r = http.send(b.build(), HttpResponse.BodyHandlers.ofByteArray())
        return Resp(r.statusCode(), r.body(), r.headers())
    }

    fun photo(api: String, token: String?, batch: String, name: String, bytes: ByteArray, key: String?, mime: String = "image/jpeg"): Resp =
        multipart("$api/api/v1/uploads/$batch/photos", token, name, bytes, key, mime)

    /** One file of a Reply (Story 7.3). */
    fun attachment(api: String, token: String?, inquiry: String, name: String, bytes: ByteArray, key: String?, mime: String = "application/octet-stream"): Resp =
        multipart("$api/api/v1/inquiries/$inquiry/attachments", token, name, bytes, key, mime)

    private fun multipart(url: String, token: String?, name: String, bytes: ByteArray, key: String?, mime: String): Resp {
        val boundary = "klei" + UUID.randomUUID().toString().replace("-", "")
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$name\"\r\nContent-Type: $mime\r\n\r\n"
        val body = head.toByteArray() + bytes + "\r\n--$boundary--\r\n".toByteArray()
        val h = mutableMapOf("Content-Type" to "multipart/form-data; boundary=$boundary")
        key?.let { h["Idempotency-Key"] = it }
        return call("POST", url, token, body, h)
    }
}
