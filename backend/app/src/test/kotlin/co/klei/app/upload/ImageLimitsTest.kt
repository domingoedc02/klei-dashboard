package co.klei.app.upload

import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ImageLimitsTest {
    private val images = ImageValidator()

    @Test fun `a 99 MP header passes and a 101 MP header is refused`() {
        assertEquals(10_000, images.inspect(Images.pngHeaderOnly(10_000, 9_900)).width)
        val e = assertFailsWith<ProblemException> { images.inspect(Images.pngHeaderOnly(10_100, 10_000)) }
        assertEquals(ProblemCode.TOO_LARGE, e.problem)
    }

    @Test fun `a 54 MP JPEG thumbnails to 480 px`() {
        val img = BufferedImage(9_000, 6_000, BufferedImage.TYPE_BYTE_GRAY)
        val jpeg = ByteArrayOutputStream().also { check(ImageIO.write(img, "jpeg", it)) }.toByteArray()
        val thumb = ThumbnailService(images).make(jpeg, images.inspect(jpeg))
        val out = ImageIO.read(thumb.inputStream())
        assertEquals(480, maxOf(out.width, out.height))
        assertTrue(thumb.size < 100_000)
    }
}
