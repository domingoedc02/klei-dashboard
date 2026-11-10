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
import kotlinx.serialization.Serializable
import java.util.UUID

/** `v` is the envelope's schema version, which the field codec requires on every structured value. */
@Serializable
class Vector(val v: Int, val values: List<Float>)

@Serializable
class Tag(val type: String, val value: String)

@Serializable
class Tags(val v: Int, val items: List<Tag>)

/** The embedding of one Photo's thumbnail (FR-9). Dies with its Photo through the database; Story 4.7 drops it at Save. */
@Entity
@Table(name = "embedding")
@EncryptedEntity("embedding")
class Embedding(
    @Id val id: UUID,
    @Column(name = "photo_id") val photoId: UUID,
    vector: Vector,
    model: String,
    dim: Int,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("vector") var vector: Vector = vector
    @Transient @Encrypted("model") var model: String = model
    @Transient @Encrypted("dim") var dim: Int = dim

    internal var vectorCt: ByteArray? = null
    internal var modelCt: ByteArray? = null
    internal var dimCt: ByteArray? = null
}

/** One AI group of an Upload Batch. Photos point at it through `photo.group_id`. Tags and description arrive with Story 4.4. */
@Entity
@Table(name = "upload_group")
@EncryptedEntity("upload_group")
class UploadGroup(
    @Id val id: UUID,
    @Column(name = "batch_id") val batchId: UUID,
    name: String,
    confidence: Int,
    position: Int,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("attributes") var attributes: Tags = Tags(1, emptyList())
    @Transient @Encrypted("description") var description: String? = null
    @Transient @Encrypted("confidence") var confidence: Int = confidence
    @Transient @Encrypted("position") var position: Int = position

    internal var nameCt: ByteArray? = null
    internal var attributesCt: ByteArray? = null
    internal var descriptionCt: ByteArray? = null
    internal var confidenceCt: ByteArray? = null
    internal var positionCt: ByteArray? = null
}
