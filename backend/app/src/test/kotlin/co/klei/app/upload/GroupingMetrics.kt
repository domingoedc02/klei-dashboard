package co.klei.app.upload

/** Pairwise scores of a clustering against ground-truth labels (Story 10.1). [clusters] hold indexes into [labels]. */
data class PairScore(val precision: Double, val recall: Double) {
    val f1: Double get() = if (precision + recall == 0.0) 0.0 else 2 * precision * recall / (precision + recall)
}

object GroupingMetrics {
    private fun choose2(n: Int): Long = n.toLong() * (n - 1) / 2

    /** Pairs of photos that share a label. */
    fun truePairs(labels: List<String>): Long = labels.groupingBy { it }.eachCount().values.sumOf(::choose2)

    /** Pairs that sit in one cluster. */
    fun predictedPairs(clusters: List<List<Int>>): Long = clusters.sumOf { choose2(it.size) }

    /** Nothing predicted counts as precision 1.0 and no true pair as recall 1.0, so a missing denominator never divides by zero. */
    fun precisionRecall(labels: List<String>, clusters: List<List<Int>>): PairScore {
        val tp = clusters.sumOf { c -> c.groupingBy { labels[it] }.eachCount().values.sumOf(::choose2) }
        val predicted = predictedPairs(clusters)
        val actual = truePairs(labels)
        return PairScore(if (predicted == 0L) 1.0 else tp.toDouble() / predicted, if (actual == 0L) 1.0 else tp.toDouble() / actual)
    }

    /** True when every photo of the cluster carries one label. */
    fun pure(cluster: List<Int>, labels: List<String>): Boolean = cluster.map { labels[it] }.toSet().size <= 1
}
