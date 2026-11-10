package co.klei.crypto

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CryptoServiceTest {
    private val svc = CryptoService(FixedDeks())
    private val col = ColumnRef("gown", "name")
    private val row = UUID.randomUUID()

    @Test fun `round trip`() {
        val plain = "Marie Curie é中".toByteArray()
        assertContentEquals(plain, svc.decrypt(svc.encrypt(plain, col, row), col, row))
    }

    @Test fun `blob size follows the padding rule`() {
        // plain length to padded frame length (frame = 4 + plain)
        val expected = mapOf(0 to 32, 1 to 32, 31 to 64, 32 to 64, 255 to 512, 256 to 512, 257 to 512, 5000 to 8192)
        for ((n, frame) in expected) {
            val blob = svc.encrypt(ByteArray(n) { 7 }, col, row)
            assertEquals(29 + frame + 16, blob.size, "plain length $n")
            assertTrue(Envelope.looksValid(blob))
            assertEquals(n, svc.decrypt(blob, col, row).size)
        }
    }

    @Test fun `equal lengths in one pad step are indistinguishable by size`() {
        assertEquals(svc.encrypt("new".toByteArray(), col, row).size, svc.encrypt("replied".toByteArray(), col, row).size)
    }

    @Test fun `nonce is fresh each time and plaintext is absent from the blob`() {
        val plain = "SENT-7f3a-unique-sentinel".toByteArray()
        val a = svc.encrypt(plain, col, row)
        val b = svc.encrypt(plain, col, row)
        assertNotEquals(a.toList(), b.toList())
        assertFalse(String(a, Charsets.ISO_8859_1).contains("SENT-7f3a"))
    }

    @Test fun `a blob moved to another row column or table fails`() {
        val blob = svc.encrypt("secret".toByteArray(), col, row)
        assertFailsWith<CryptoException> { svc.decrypt(blob, col, UUID.randomUUID()) }
        assertFailsWith<CryptoException> { svc.decrypt(blob, ColumnRef("gown", "description"), row) }
        assertFailsWith<CryptoException> { svc.decrypt(blob, ColumnRef("client", "name"), row) }
    }

    @Test fun `a flipped bit or truncation fails and the exception holds a code only`() {
        val blob = svc.encrypt("secret".toByteArray(), col, row)
        val bad = blob.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        val e = assertFailsWith<CryptoException> { svc.decrypt(bad, col, row) }
        assertEquals("decrypt_failed", e.code)
        assertFalse(e.message!!.contains("secret"))
        assertFailsWith<CryptoException> { svc.decrypt(blob.copyOf(20), col, row) }
    }

    @Test fun `an unknown dek id fails`() {
        val blob = svc.encrypt("x".toByteArray(), col, row)
        assertFailsWith<CryptoException> { CryptoService(FixedDeks()).decrypt(blob, col, row) }
    }

    @Test fun `an older dek still decrypts after a newer one is active`() {
        val old = Dek(UUID.randomUUID(), ByteArray(32) { 1 })
        val blob = CryptoService(FixedDeks(listOf(old))).encrypt("old".toByteArray(), col, row)
        val now = CryptoService(FixedDeks(listOf(old, Dek(UUID.randomUUID(), ByteArray(32) { 2 }))))
        assertContentEquals("old".toByteArray(), now.decrypt(blob, col, row))
    }
}
