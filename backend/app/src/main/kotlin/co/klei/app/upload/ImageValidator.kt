package co.klei.app.upload

import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import org.springframework.stereotype.Component
import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import javax.imageio.ImageReader

/** What the header says, read without decoding any pixel. */
class Inspected(val type: ImageType, val width: Int, val height: Int)

/**
 * AD-7: the type comes from magic bytes, never from the request. The header is read first and refused above
 * [maxPixels], so a small file that claims a huge canvas never reaches a decoder (decompression bomb).
 */
@Component
class ImageValidator {
    init {
        // The WebP reader sits in a nested jar; make sure ImageIO has scanned the class path that holds it.
        ImageIO.scanForPlugins()
    }

    fun inspect(bytes: ByteArray): Inspected {
        val type = sniff(bytes) ?: throw ProblemException(ProblemCode.UNSUPPORTED_TYPE)
        val (w, h) = try {
            reader(bytes, type) { r -> r.getWidth(0) to r.getHeight(0) }
        } catch (_: Exception) {
            throw ProblemException(ProblemCode.UNSUPPORTED_TYPE)
        }
        if (w < 1 || h < 1) throw ProblemException(ProblemCode.UNSUPPORTED_TYPE)
        if (w.toLong() * h > maxPixels(type)) throw ProblemException(ProblemCode.TOO_LARGE)
        return Inspected(type, w, h)
    }

    fun <T> reader(bytes: ByteArray, type: ImageType, use: (ImageReader) -> T): T {
        val reader = ImageIO.getImageReadersByFormatName(type.format).asSequence().firstOrNull()
            ?: throw ProblemException(ProblemCode.UNSUPPORTED_TYPE)
        try {
            ImageIO.createImageInputStream(ByteArrayInputStream(bytes)).use { input ->
                reader.setInput(input, true, true)
                return use(reader)
            }
        } finally {
            reader.dispose()
        }
    }

    companion object {
        /** JPEG and PNG decode at 1/n scale (see [ThumbnailService]), so heap holds the thumbnail, not the photo. */
        const val MAX_PIXELS = 100_000_000L

        /** WebP is read whole at 4 bytes a pixel, so 40 MP is 160 MB of heap. */
        const val MAX_WEBP_PIXELS = 40_000_000L

        fun maxPixels(type: ImageType) = if (type == ImageType.WEBP) MAX_WEBP_PIXELS else MAX_PIXELS

        fun sniff(b: ByteArray): ImageType? = when {
            b.size >= 3 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() && b[2] == 0xFF.toByte() -> ImageType.JPEG
            b.size >= 8 && b.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) -> ImageType.PNG
            b.size >= 12 && String(b, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(b, 8, 4, Charsets.ISO_8859_1) == "WEBP" -> ImageType.WEBP
            else -> null
        }
    }
}
