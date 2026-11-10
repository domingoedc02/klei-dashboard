package co.klei.app.upload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Operator-run (Story 10.1): `./mvnw -pl app -am test -Dtest=GroupingEvalTest -Deval.vectors=/path/vectors.json`.
 * Runs the real [Clusterer] over vectors written by `infra/eval/embed.py` and prints precision and recall per sensitivity.
 * Skipped when `eval.vectors` is not set, so `./mvnw verify` is unchanged.
 */
class GroupingEvalTest {
    @Test fun `report`() {
        val path = System.getProperty("eval.vectors")
        assumeTrue(!path.isNullOrBlank(), "eval.vectors not set")
        val items = Json.parseToJsonElement(File(path).readText()).jsonObject["items"]!!.jsonArray.map { it as JsonObject }
        val labels = items.map { it["label"]!!.jsonPrimitive.content }
        val vectors = items.map { i -> (i["vector"] as JsonArray).map { it.jsonPrimitive.float }.toFloatArray() }
        require(labels.toSet().size >= 2) { "need at least two labelled gowns" }

        val out = StringBuilder("\nphotos=${labels.size} gowns=${labels.toSet().size} true pairs=${GroupingMetrics.truePairs(labels)}\n")
        out.append("sens  thr   groups/gowns  precision  recall  f1    high(pure/n)  medium(pure/n)  low(pure/n)\n")
        for (s in 1..5) {
            val t = Clusterer.threshold(s)
            val clusters = Clusterer.cluster(vectors, t)
            val m = clusters.map { it.members }
            val score = GroupingMetrics.precisionRecall(labels, m)
            val bands = listOf("high", "medium", "low").joinToString("  ") { b ->
                val inBand = clusters.filter { confidenceBand(it.confidence) == b }
                "%d/%d".format(inBand.count { GroupingMetrics.pure(it.members, labels) }, inBand.size)
            }
            out.append("%-5d %.2f  %3d/%-8d  %.3f      %.3f   %.3f %s\n".format(s, t, clusters.size, labels.toSet().size, score.precision, score.recall, score.f1, bands))
        }
        out.append("default sensitivity is 3; its High column is the count of wrongly merged groups the reviewer would see as High.\n")
        println(out)
        assertTrue(vectors.isNotEmpty())
    }
}
