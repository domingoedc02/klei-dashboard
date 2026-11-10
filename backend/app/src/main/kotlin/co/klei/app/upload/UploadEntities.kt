package co.klei.app.upload

import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import org.hibernate.annotations.OptimisticLock
import java.time.Instant
import java.util.UUID

/** Stored `empty`, `processing`, `review`, `error`. Story 4.1 only ever writes `empty`. */
enum class BatchPhase { EMPTY, PROCESSING, REVIEW, ERROR }

/** The only image types Photos may have. [mime] is the one Content-Type the API ever answers with for an original. */
enum class ImageType(val mime: String, val format: String) {
    JPEG("image/jpeg", "jpeg"),
    PNG("image/png", "png"),
    WEBP("image/webp", "webp"),
}

/**
 * Key material of one S3 object: its wrapped DEK and KEK version. `created_at` is null for rows from before Story 4.1
 * and is what the orphan sweep ages by.
 */
@Entity
@Table(name = "stored_object")
@EncryptedEntity("stored_object")
class StoredObject(
    @Id val id: UUID,
    @Column(name = "wrapped_dek") val wrappedDek: ByteArray,
    @Column(name = "kek_version") val kekVersion: Int,
    createdAt: Instant?,
) : EncryptedEntityBase() {
    @Transient @Encrypted("created_at") var createdAt: Instant? = createdAt

    internal var createdAtCt: ByteArray? = null
}

/**
 * The one active Upload Batch of a User (FR-8). The rejected-file count sits outside the version, and is only
 * changed under a row lock, so a rejection never turns a parallel upload into a stale write.
 */
@Entity
@Table(name = "upload_batch")
@EncryptedEntity("upload_batch")
class UploadBatch(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID,
    phase: BatchPhase,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("phase") var phase: BatchPhase = phase
    @Transient @Encrypted("progress") var progress: Int? = null
    @Transient @Encrypted("error") var error: String? = null
    @Transient @Encrypted("rejected") var rejected: Int = 0
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    internal var phaseCt: ByteArray? = null
    internal var progressCt: ByteArray? = null
    internal var errorCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) internal var rejectedCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
}

/** Set on a Photo the Staff member dropped in review (Story 4.6); its objects stay until Save or Discard batch (Story 4.7). */
enum class PhotoState { DISCARDED }

/** One uploaded image: the original and its thumbnail are two encrypted objects. Save moves it to a Gown: `gown_id` set, `batch_id` and `group_id` cleared. */
@Entity
@Table(name = "photo")
@EncryptedEntity("photo")
class Photo(
    @Id val id: UUID,
    @Column(name = "batch_id") var batchId: UUID?,
    @Column(name = "original_object_id") val originalObjectId: UUID,
    @Column(name = "thumb_object_id") val thumbObjectId: UUID,
    @Column(name = "idem_bidx") val idemBidx: ByteArray,
    filename: String,
    contentType: String,
    size: Long,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Column(name = "gown_id") var gownId: UUID? = null
    @Column(name = "group_id") var groupId: UUID? = null

    @Transient @Encrypted("filename") var filename: String = filename
    @Transient @Encrypted("content_type") var contentType: String = contentType
    @Transient @Encrypted("size") var size: Long = size
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt
    @Transient @Encrypted("state") var state: PhotoState? = null

    internal var stateCt: ByteArray? = null
    internal var filenameCt: ByteArray? = null
    internal var contentTypeCt: ByteArray? = null
    internal var sizeCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
}
