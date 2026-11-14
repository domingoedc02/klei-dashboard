package co.klei.app.upload

import kotlin.math.sqrt

/** One AI group: indexes into the input list (ascending) and the mean similarity of its members scaled to 0..100. */
data class Cluster(val members: List<Int>, val confidence: Int)

/**
 * Cosine similarity of every pair, kept as one triangle of floats: 4 bytes per pair, so 5,000 photos take 50 MB.
 * The diagonal is not stored; it reads as 1.
 */
class Sims(val n: Int, private val v: FloatArray) {
    operator fun get(i: Int, j: Int): Double = if (i == j) 1.0 else v[at(i, j)].toDouble()

    internal fun getF(i: Int, j: Int): Float = v[at(i, j)]

    internal fun set(i: Int, j: Int, x: Float) { v[at(i, j)] = x }

    internal fun copy() = Sims(n, v.copyOf())

    private fun at(i: Int, j: Int): Int {
        val a = minOf(i, j)
        val b = maxOf(i, j)
        return (b.toLong() * (b - 1) / 2 + a).toInt()
    }
}

/**
 * Average-link agglomerative clustering on cosine similarity (FR-9, architecture §4.3). Pure and deterministic:
 * the same vectors in the same order give the same groups. Joins the closest pair of clusters until none reaches
 * the threshold. Nearest-neighbour chain makes it O(n^2) time and one working copy of [Sims] in memory, so the batch
 * size is bounded by Upload Limits (`klei.upload.max-photos`), not by this class. Only photos that tie exactly
 * can come out in a different order than a global closest-pair search; the groups are the same.
 */
object Clusterer {
    private val THRESHOLDS = doubleArrayOf(0.55, 0.65, 0.75, 0.82, 0.88)

    /** Grouping sensitivity 1 (very loose) to 5 (very strict); anything outside is clamped. */
    fun threshold(sensitivity: Int): Double = THRESHOLDS[sensitivity.coerceIn(1, 5) - 1]

    /** A group of one has no pair to average, so it reads as 0 and lands in the Low band for the User to look at. */
    fun cluster(vectors: List<FloatArray>, threshold: Double, sims: Sims = similarities(vectors)): List<Cluster> {
        val n = vectors.size
        if (n == 0) return emptyList()
        val w = sims.copy()
        val size = IntArray(n) { 1 }
        val members = Array(n) { mutableListOf(it) }
        val active = BooleanArray(n) { true }
        val finished = mutableListOf<Int>()
        var left = n
        val chain = IntArray(n)
        var top = 0
        var seed = 0
        while (left > 1) {
            if (top == 0) { while (!active[seed]) seed++; chain[top++] = seed }
            val x = chain[top - 1]
            val prev = if (top >= 2) chain[top - 2] else -1
            var b = prev
            var best = if (prev >= 0) w.getF(x, prev) else Float.NEGATIVE_INFINITY
            for (k in 0 until n) if (active[k] && k != x && k != prev) {
                val s = w.getF(x, k)
                if (s > best) { best = s; b = k }
            }
            if (b != prev) { chain[top++] = b; continue }
            top -= 2
            val i = minOf(x, prev)
            val j = maxOf(x, prev)
            if (best >= threshold) {
                for (k in 0 until n) if (active[k] && k != i && k != j) {
                    w.set(i, k, (size[i] * w.getF(i, k) + size[j] * w.getF(j, k)) / (size[i] + size[j]))
                }
                size[i] += size[j]
                members[i].addAll(members[j])
                active[j] = false
                left--
            } else {
                // Average-link only lowers a cluster's best similarity as others merge, so neither can ever reach the threshold.
                active[i] = false; active[j] = false; finished += listOf(i, j); left -= 2
            }
        }
        val out = finished + (0 until n).filter { active[it] }
        return out.map { c ->
            val m = members[c].sorted()
            Cluster(m, confidence(m, sims))
        }.sortedBy { it.members.first() }
    }

    /** Cosine similarity of every pair, from the vectors as given (they are normalised here). */
    fun similarities(vectors: List<FloatArray>): Sims {
        val n = vectors.size
        require(n < 2 || vectors.all { it.size == vectors[0].size }) { "vectors differ in dimension" }
        require(n.toLong() * (n - 1) / 2 <= Int.MAX_VALUE) { "too many vectors: $n" }
        val unit = vectors.map(::normalise)
        val sims = Sims(n, FloatArray((n.toLong() * (n - 1) / 2).toInt()))
        for (j in 1 until n) for (i in 0 until j) sims.set(i, j, dot(unit[i], unit[j]).toFloat())
        return sims
    }

    /** Half the mean, half the weakest pair: the mean alone hides one photo that does not belong (Story 10.2). */
    fun confidence(m: List<Int>, sim: Sims): Int {
        if (m.size < 2) return 0
        var sum = 0.0
        var pairs = 0
        var min = 1.0
        for (x in m.indices) for (y in x + 1 until m.size) { val s = sim[m[x], m[y]]; sum += s; pairs++; if (s < min) min = s }
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
