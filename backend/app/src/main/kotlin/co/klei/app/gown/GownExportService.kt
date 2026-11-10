package co.klei.app.gown

import co.klei.app.identity.PreferencesService
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.ImageType
import co.klei.app.upload.Photo
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.taxonomy.TaxonomyType
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter
import java.util.UUID

class ExportPhoto(val id: UUID, val type: String)

/** One Gown of a download: [photos] in upload order, [details] the text of its `details.txt`. */
class ExportGown(val gownId: UUID, val name: String, val photos: List<ExportPhoto>, val details: String)

/** [missing] are the asked ids that are not Gowns (any more). Nothing is built or kept here: the shell fetches the photos one at a time and writes the archive. */
class ExportManifest(val items: List<ExportGown>, val missing: List<UUID>)

/** FR-17: what the shell needs to build a .zip. The server never holds the archive. */
@Service
class GownExportService(private val em: EntityManager, private val prefs: PreferencesService) {
    companion object {
        const val MAX_GOWNS = 100
        const val MAX_BYTES = 100L * 1024 * 1024
    }

    @Transactional(readOnly = true)
    fun manifest(ids: List<UUID>, callerId: UUID): ExportManifest {
        val wanted = ids.distinct()
        if (wanted.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("ids", "required")))
        if (wanted.size > MAX_GOWNS) throw ProblemException(ProblemCode.TOO_LARGE)

        val gowns = em.createQuery("select g from Gown g where g.id in :ids", Gown::class.java).setParameter("ids", wanted).resultList.associateBy { it.id }
        val missing = wanted.filter { it !in gowns }
        if (gowns.isEmpty()) return ExportManifest(emptyList(), missing)

        val photos = em.createQuery("select p from Photo p where p.gownId in :ids", Photo::class.java).setParameter("ids", gowns.keys).resultList
        if (photos.sumOf { it.size } > MAX_BYTES) throw ProblemException(ProblemCode.TOO_LARGE)

        val tags = em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id }
        val attrs = em.createQuery("select a from GownAttribute a where a.gownId in :ids", GownAttribute::class.java).setParameter("ids", gowns.keys).resultList.groupBy { it.gownId }
        val byGown = photos.groupBy { it.gownId }

        val date = prefs.dates(callerId)
        val items = wanted.mapNotNull { gowns[it] }.map { g ->
            val mine = attrs[g.id].orEmpty().mapNotNull { tags[it.taxonomyValueId] }
            val files = byGown[g.id].orEmpty().sortedWith(compareBy({ it.createdAt }, { it.id }))
                .map { p -> ExportPhoto(p.id, ImageType.entries.first { it.mime == p.contentType }.format) }
            ExportGown(g.id, g.name, files, details(g, mine, date))
        }
        return ExportManifest(items, missing)
    }

    private fun details(g: Gown, tags: List<TaxonomyValue>, date: DateTimeFormatter) = buildString {
        append("Name: ").append(g.name).append('\n')
        for (t in TaxonomyType.entries) {
            val values = tags.filter { it.type == t }.map { it.value }.sortedBy { it.lowercase() }
            if (values.isNotEmpty()) append(t.code.replaceFirstChar(Char::uppercase)).append(": ").append(values.joinToString(", ")).append('\n')
        }
        append("Date added: ").append(date.format(g.createdAt)).append("\n\n")
        append("Description:\n").append((g.description ?: "No description yet.").replace("\r\n", "\n").replace('\r', '\n')).append('\n')
    }
}
