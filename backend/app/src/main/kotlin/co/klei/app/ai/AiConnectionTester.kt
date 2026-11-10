package co.klei.app.ai

import co.klei.core.ai.AiCall
import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import co.klei.core.ai.AiProviderPort
import co.klei.core.ai.AiPurpose
import org.springframework.stereotype.Service
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.UUID
import javax.imageio.ImageIO

data class AiCheck(val id: String, val label: String, val ok: Boolean, val detail: String)
data class AiTestResult(val checks: List<AiCheck>, val status: String)

/**
 * Test connection (FR-37): three checks on the saved settings, in order. Sends no client data: only a generated test image.
 * Deliberately not transactional; every provider call must run outside a DB transaction (AD-13).
 */
@Service
class AiConnectionTester(private val settings: AiSettingService, private val port: AiProviderPort) {
    fun run(userId: UUID): AiTestResult {
        val cfg = try { settings.config() } catch (e: AiProviderException) { return fail(AiFailure.NOT_CONFIGURED.detail) }
        val version = cfg.version
        val call = AiCall(AiPurpose.TEST, userId)
        var models: List<String>? = null
        val reachable = attempt("reachable", "Provider reachable") { models = port.listModels(call); "OK" }
        val loaded = if (!reachable.ok) skipped("models", "Models loaded") else {
            val n = models!!.size
            AiCheck("models", "Models loaded", n > 0, if (n > 0) "$n models" else "No models")
        }
        // A separate embeddings provider is a different server, so the main one being down does not skip its check.
        val embedded = if (!reachable.ok && cfg.embeddingBaseUrl == null) skipped("embedding", "Image embedding") else attempt("embedding", "Image embedding") {
            val dim = port.embed(call, testImage(), "image/png").size
            if (dim == 0) throw AiProviderException(AiFailure.BAD_RESPONSE, "dimension 0")
            "dimension $dim"
        }
        val checks = listOf(reachable, loaded, embedded)
        val status = if (checks.all { it.ok }) AiStatus.CONNECTED else AiStatus.FAILED
        settings.recordTest(version, status, if (reachable.ok) models else null)
        return AiTestResult(checks, status.name.lowercase())
    }

    private fun attempt(id: String, label: String, op: () -> String) = try {
        AiCheck(id, label, true, op())
    } catch (e: AiProviderException) {
        AiCheck(id, label, false, e.detail)
    }

    private fun skipped(id: String, label: String) = AiCheck(id, label, false, "Skipped")

    private fun fail(detail: String) = AiTestResult(
        listOf(AiCheck("reachable", "Provider reachable", false, detail), skipped("models", "Models loaded"), skipped("embedding", "Image embedding")), "failed",
    )

    /** A 64 by 64 gradient: big enough for an image model, nothing that belongs to a client. */
    private fun testImage(): ByteArray {
        val img = BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB)
        for (y in 0 until 64) for (x in 0 until 64) img.setRGB(x, y, (x * 4 shl 16) or (y * 4 shl 8) or 128)
        return ByteArrayOutputStream().also { ImageIO.write(img, "png", it) }.toByteArray()
    }
}
