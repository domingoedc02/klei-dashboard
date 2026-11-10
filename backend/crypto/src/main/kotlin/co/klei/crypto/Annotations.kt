package co.klei.crypto

/** Entity whose `@Encrypted` fields live in `*_ct` columns. [table] is the logical name used in the AAD. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class EncryptedEntity(val table: String)

/**
 * On a `@Transient` property `x`: stored in the mapped `xCt: ByteArray?` property of the same entity.
 * [column] is the logical column name used in the AAD.
 */
@Target(AnnotationTarget.FIELD)
@Retention(AnnotationRetention.RUNTIME)
annotation class Encrypted(val column: String)

/** On the mapped `yBidx: ByteArray?` property: filled from the plaintext of the `@Encrypted` property named [of]. */
@Target(AnnotationTarget.FIELD)
@Retention(AnnotationRetention.RUNTIME)
annotation class BlindIndexed(val domain: BidxDomain, val of: String)

/** Marks the only repositories allowed raw `INSERT`/`UPDATE` on `_ct` or `_bidx` tables (re-wrap, leak tests). */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class RawCiphertext
