package com.httpgateway.protocol

data class Line(
    val id: String,
    val label: String,
    val isEsim: Boolean,
    val active: Boolean
)

sealed class LineSelectionResult {
    data class Use(val id: String) : LineSelectionResult()
    object Ambiguous : LineSelectionResult()
    data class Single(val id: String) : LineSelectionResult()
    object None : LineSelectionResult()
    object Invalid : LineSelectionResult()
}

object LineSelection {
    fun choose(lines: List<Line>, saved: String?): LineSelectionResult {
        val ids = mutableSetOf<String>()
        for (line in lines) {
            if (line.id.isBlank() || line.label.isBlank()) return LineSelectionResult.Invalid
            if (!ids.add(line.id)) return LineSelectionResult.Invalid
        }

        val activeLines = lines.filter { it.active }

        if (activeLines.isEmpty()) {
            return LineSelectionResult.None
        }

        val savedActiveLine = activeLines.find { it.id == saved }
        if (savedActiveLine != null) {
            return LineSelectionResult.Use(savedActiveLine.id)
        }

        if (activeLines.size == 1) {
            return LineSelectionResult.Single(activeLines.first().id)
        }

        return LineSelectionResult.Ambiguous
    }
}
