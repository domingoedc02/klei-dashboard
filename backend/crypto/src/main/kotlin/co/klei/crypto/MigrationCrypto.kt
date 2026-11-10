package co.klei.crypto

import java.util.UUID

/** Narrow surface for Flyway `JavaMigration` data migrations: the only way a migration may touch crypto. */
interface MigrationCrypto {
    fun encrypt(plain: ByteArray, col: ColumnRef, rowId: UUID): ByteArray
    fun decrypt(blob: ByteArray, col: ColumnRef, rowId: UUID): ByteArray
    fun blindIndex(domain: BidxDomain, value: String): ByteArray
}

internal class MigrationCryptoImpl(private val crypto: CryptoService, private val bidx: BlindIndex) : MigrationCrypto {
    override fun encrypt(plain: ByteArray, col: ColumnRef, rowId: UUID) = crypto.encrypt(plain, col, rowId)
    override fun decrypt(blob: ByteArray, col: ColumnRef, rowId: UUID) = crypto.decrypt(blob, col, rowId)
    override fun blindIndex(domain: BidxDomain, value: String) = bidx.of(domain, value)
}
