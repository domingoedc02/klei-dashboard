package co.klei.crypto

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ObjectCipherTest {
    private val cipher = ObjectCipher(KeyRing.parse(testEnv(active = 2, keks = 2)))

    @Test fun `round trips 1 byte 64 KB and 25 MB with 64 KB padding`() {
        for (n in listOf(1, 64 * 1024 - 4, 64 * 1024, 25 * 1024 * 1024)) {
            val id = UUID.randomUUID()
            val plain = ByteArray(n) { (it * 31).toByte() }
            val sealed = cipher.encrypt(plain, "klei-objects", id)
            assertEquals(0, (sealed.body.size - 1 - 12 - 16) % (64 * 1024), "size $n")
            assertEquals(2, sealed.kekVersion)
            assertContentEquals(plain, cipher.decrypt(sealed, "klei-objects", id))
        }
    }

    @Test fun `wrong object id or bucket fails`() {
        val id = UUID.randomUUID()
        val sealed = cipher.encrypt(ByteArray(10), "klei-objects", id)
        assertFailsWith<CryptoException> { cipher.decrypt(sealed, "klei-objects", UUID.randomUUID()) }
        assertFailsWith<CryptoException> { cipher.decrypt(sealed, "other", id) }
    }

    @Test fun `each object has its own dek`() {
        val id = UUID.randomUUID()
        val a = cipher.encrypt(ByteArray(10), "b", id)
        val b = cipher.encrypt(ByteArray(10), "b", id)
        assertFalse(a.wrappedDek.contentEquals(b.wrappedDek))
    }

    private fun assertFalse(v: Boolean) = kotlin.test.assertFalse(v)
}
