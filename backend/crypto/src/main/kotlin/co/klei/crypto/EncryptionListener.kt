package co.klei.crypto

import org.hibernate.Interceptor
import org.hibernate.type.Type
import java.lang.reflect.Field
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Transparent column encryption (architecture §5.3). One session-factory interceptor:
 * - load: decrypts each `@Encrypted` field from its `*_ct` state value and records the canonical plaintext as a snapshot;
 * - insert: writes ciphertext (and blind indexes) into the insert state;
 * - flush: re-encrypts a field only when its canonical plaintext differs from the snapshot, so an unchanged field keeps
 *   byte-identical ciphertext. Default dirty checking then sees the changed `*_ct` bytes.
 */
internal class EncryptionListener(private val crypto: CryptoService, private val bidx: BlindIndex) : Interceptor {
    private class Enc(val plain: Field, val ct: Field, val col: ColumnRef)
    private class Bx(val field: Field, val domain: BidxDomain, val source: Enc)
    private class Meta(val encs: List<Enc>, val bidxs: List<Bx>)

    private val metas = ConcurrentHashMap<Class<*>, Meta>()
    private val none = Meta(emptyList(), emptyList())

    private fun meta(entity: Any): Meta? = metas.computeIfAbsent(entity.javaClass) { build(it) }.takeIf { it !== none }

    private fun build(cls: Class<*>): Meta {
        val table = generateSequence(cls) { it.superclass }.firstNotNullOfOrNull { it.getAnnotation(EncryptedEntity::class.java) }?.table ?: return none
        val fields = generateSequence(cls) { it.superclass }.flatMap { it.declaredFields.asSequence() }.onEach { it.isAccessible = true }.toList()
        fun field(name: String) = fields.firstOrNull { it.name == name } ?: throw IllegalStateException("${cls.simpleName}: no field $name")
        val encs = fields.mapNotNull { f -> f.getAnnotation(Encrypted::class.java)?.let { Enc(f, field(f.name + "Ct"), ColumnRef(table, it.column)) } }
        val bxs = fields.mapNotNull { f ->
            f.getAnnotation(BlindIndexed::class.java)?.let { a -> Bx(f, a.domain, encs.firstOrNull { it.plain.name == a.of } ?: throw IllegalStateException("${cls.simpleName}: no @Encrypted ${a.of}")) }
        }
        return Meta(encs, bxs)
    }

    private fun snap(entity: Any) = (entity as EncryptedEntityBase).snapshot

    override fun onLoad(entity: Any, id: Any, state: Array<Any?>, names: Array<String>, types: Array<Type>): Boolean {
        val m = meta(entity) ?: return false
        val snap = snap(entity)
        snap.clear()
        for (e in m.encs) {
            val blob = state[names.indexOf(e.ct.name)] as ByteArray?
            val bytes = blob?.let { crypto.decrypt(it, e.col, id as UUID) }
            e.plain.set(entity, bytes?.let { FieldCodec.decodeAny(it, e.plain.genericType) })
            snap[e.plain.name] = bytes
        }
        return false
    }

    override fun onPersist(entity: Any, id: Any, state: Array<Any?>, names: Array<String>, types: Array<Type>): Boolean {
        val m = meta(entity) ?: return false
        write(m, entity, id as UUID, state, names, force = true)
        return true
    }

    override fun findDirty(entity: Any, id: Any, current: Array<Any?>, previous: Array<Any?>?, names: Array<String>, types: Array<Type>): IntArray? {
        val m = meta(entity) ?: return null
        write(m, entity, id as UUID, current, names, force = false)
        return null
    }

    private fun write(m: Meta, entity: Any, rowId: UUID, state: Array<Any?>, names: Array<String>, force: Boolean) {
        val snap = snap(entity)
        val changed = HashSet<Enc>()
        for (e in m.encs) {
            val bytes = e.plain.get(entity)?.let { FieldCodec.encodeAny(it, e.plain.genericType) }
            if (!force && snap.containsKey(e.plain.name) && bytes.contentEqualsOrNull(snap[e.plain.name])) continue
            val ct = bytes?.let { crypto.encrypt(it, e.col, rowId) }
            e.ct.set(entity, ct)
            state[names.indexOf(e.ct.name)] = ct
            snap[e.plain.name] = bytes
            changed += e
        }
        for (b in m.bidxs) {
            if (b.source !in changed) continue
            val v = snap[b.source.plain.name]?.let { bidx.of(b.domain, String(it, Charsets.UTF_8)) }
            b.field.set(entity, v)
            state[names.indexOf(b.field.name)] = v
        }
    }

    private fun ByteArray?.contentEqualsOrNull(o: ByteArray?) = if (this == null || o == null) this == null && o == null else contentEquals(o)
}
