package com.httpgateway.dialer

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/** Jezik zaslonov: sistem, anglescina ali slovenscina. Anglescina ostane. */
object AppLocale {
    const val PREFS = "app_locale"
    const val KEY = "mode"
    const val SYSTEM = "system"
    const val EN = "en"
    const val SL = "sl"

    fun mode(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, SYSTEM) ?: SYSTEM

    fun save(context: Context, mode: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, mode).apply()
    }

    fun wrap(base: Context): Context {
        val chosen = mode(base)
        if (chosen == SYSTEM || chosen.isBlank()) return base
        val locale = Locale.forLanguageTag(chosen)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        return base.createConfigurationContext(config)
    }
}
