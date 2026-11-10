package co.klei.app.upload

import kotlin.math.sqrt

/** One AI group: indexes into the input list (ascending) and the mean similarity of its members scaled to 0..100. */
data class Cluster(val members: List<Int>, val confidence: Int)

/**
 * Average-link agglomerative clustering on cosine similarity (FR-9, architecture §4.3). Pure and deterministic:
 * the same vectors in the same order give the same groups. Merges the closest pair of clusters until none reaches
 * the threshold. Cost is O(n^3) in the batch size, which Upload Limits cap at 200.
 */
object Clusterer {
    private val THRESHOLDS = doubleArrayOf(0.55, 0.65, 0.75, 0.82, 0.88)

    /** Grouping sensitivity 1 (very loose) to 5 (very strict); anything outside is clamped. */
    fun threshold(sensitivity: Int): Double = THRESHOLDS[sensitivity.coerceIn(1, 5) - 1]

    /** A group of one has no pair to average, so it reads as 0 and lands in the Low band for the User to look at. */
    fun cluster(vectors: List<FloatArray>, threshold: Double): List<Cluster> {
        val n = vectors.size
        if (n == 0) return emptyList()
        val dim = vectors[0].size
        require(vectors.all { it.size == dim }) { "vectors differ in dimension" }
        val sim = similarities(vectors)

        val members = MutableList(n) { mutableListOf(it) }
        val live = (0 until n).toMutableList()
        // pairSum[a][b]: sum of similarities between every member of a and every member of b.
        val pairSum = Array(n) { sim[it].copyOf() }
        while (live.size > 1) {
            var best = -1.0
            var bi = -1
            var bj = -1
            for (x in live.indices) for (y in x + 1 until live.size) {
                val a = live[x]
                val b = live[y]
                val avg = pairSum[a][b] / (members[a].size.toDouble() * members[b].size)
                if (avg > best) { best = avg; bi = a; bj = b }
            }
            if (best < threshold) break
            for (k in live) if (k != bi && k != bj) { pairSum[bi][k] += pairSum[bj][k]; pairSum[k][bi] = pairSum[bi][k] }
            members[bi].addAll(members[bj])
            live.remove(bj)
        }
        return live.map { c ->
            val m = members[c].sorted()
            Cluster(m, confidence(m, sim))
        }.sortedBy { it.members.first() }
    }

    /** Cosine similarity of every pair, from the vectors as given (they are normalised here). */
    fun similarities(vectors: List<FloatArray>): Array<DoubleArray> {
        val unit = vectors.map(::normalise)
        return Array(unit.size) { i -> DoubleArray(unit.size) { j -> if (i == j) 1.0 else dot(unit[i], unit[j]) } }
    }

    /** Half the mean, half the weakest pair: the mean alone hides one photo that does not belong (Story 10.2). */
    fun confidence(m: List<Int>, sim: Array<DoubleArray>): Int {
        if (m.size < 2) return 0
        var sum = 0.0
        var pairs = 0
        var min = 1.0
        for (x in m.indices) for (y in x + 1 until m.size) { val s = sim[m[x]][m[y]]; sum += s; pairs++; if (s < min) min = s }
        return Math.round((0.5 * sum / pairs + 0.5 * min).coerceIn(0.0, 1.0) * 100).toInt()
    }

    private fun normalise(v: FloatArray): DoubleArray {
        val norm = sqrt(v.sumOf { it.toDouble() * it })
        return DoubleArray(v.size) { if (norm == 0.0) 0.0 else v[it] / norm }
    }

    private fun dot(a: DoubleArray, b: DoubleArray): Double { var s = 0.0; for (i in a.indices) s += a[i] * b[i]; return s }
}

/** Wireframe bands: 90 and up High, 80 and up Medium, else Low. */
fun confidenceBand(confidence: Int): String = when { confidence >= 90 -> "high"; confidence >= 80 -> "medium"; else -> "low" }
