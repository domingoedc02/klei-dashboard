package co.klei.crypto

import org.hibernate.Interceptor
import java.util.UUID
import javax.sql.DataSource

/** The one public entry of the module (AD-2): builds every piece from the environment and a DataSource. */
class CryptoModule(env: Map<String, String>, db: DataSource, otherSecrets: Map<String, String> = emptyMap()) {
    private val ring = KeyRing.parse(env, otherSecrets)
    private val deks = DekStore(db, ring)

    val crypto = CryptoService(deks)
    val blindIndex = BlindIndex(ring)
    val objects = ObjectCipher(ring)
    val tokens = SecureTokens(blindIndex)
    val passwords = PasswordHasher()
    val jwt = TokenSigner(ring.jwtKey)
    val rotation = KeyRotation(ring)
    val migration: MigrationCrypto = MigrationCryptoImpl(crypto, blindIndex)
    /** Register as `hibernate.session_factory.interceptor`. */
    val interceptor: Interceptor = EncryptionListener(crypto, blindIndex)

    /** Startup check (architecture §9.2): `data_key` readable, every row's KEK configured, and a round trip works. */
    fun selfTest() {
        val col = ColumnRef("self_test", "value")
        val row = UUID.randomUUID()
        val plain = Jca.random(24)
        if (!plain.contentEquals(crypto.decrypt(crypto.encrypt(plain, col, row), col, row))) throw CryptoException("self_test_failed")
    }

    companion object {
        /** Validates keys without a database: startup checks 1 and 2. Throws [KeyRingException]. */
        fun checkKeys(env: Map<String, String>, otherSecrets: Map<String, String> = emptyMap()) {
            KeyRing.parse(env, otherSecrets)
        }
    }
}
