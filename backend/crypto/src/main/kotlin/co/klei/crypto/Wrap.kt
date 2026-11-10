package co.klei.crypto

/** DEK wrapping under a KEK: `[nonce:12][ciphertext + tag]`, AAD `dek|<id>` (architecture §5.4). */
internal object Wrap {
    fun wrap(kek: ByteArray, dek: ByteArray, id: String): ByteArray {
        val nonce = Jca.random(12)
        return nonce + Jca.seal(kek, nonce, aad(id), dek)
    }

    fun unwrap(kek: ByteArray, wrapped: ByteArray, id: String): ByteArray {
        if (wrapped.size != 12 + 32 + 16) throw CryptoException("bad_wrapped_key")
        return Jca.open(kek, wrapped.copyOfRange(0, 12), aad(id), wrapped.copyOfRange(12, wrapped.size))
    }

    private fun aad(id: String) = "dek|$id".toByteArray(Charsets.UTF_8)
}
