package co.klei.crypto

/** Logical table and column names from the annotations, not the DB names (architecture §5.2). */
data class ColumnRef(val table: String, val column: String)
