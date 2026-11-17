package com.shomer.einayim

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest
import java.security.SecureRandom

object Prefs {
    private const val NAME = "shomer_prefs"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_PIN_HASH = "pin_hash"
    private const val KEY_PIN_SALT = "pin_salt"
    private const val KEY_BLOCKED = "user_blocked"
    private const val KEY_ALLOWED = "user_allowed"
    private const val KEY_COUNT = "blocked_count"

    private fun p(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun isEnabled(ctx: Context) = p(ctx).getBoolean(KEY_ENABLED, false)
    fun setEnabled(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean(KEY_ENABLED, v).apply()

    fun blockedCount(ctx: Context) = p(ctx).getLong(KEY_COUNT, 0L)
    fun addBlocked(ctx: Context, n: Long) {
        val prefs = p(ctx)
        prefs.edit().putLong(KEY_COUNT, prefs.getLong(KEY_COUNT, 0L) + n).apply()
    }

    fun userBlocked(ctx: Context): String = p(ctx).getString(KEY_BLOCKED, "") ?: ""
    fun userAllowed(ctx: Context): String = p(ctx).getString(KEY_ALLOWED, "") ?: ""
    fun setLists(ctx: Context, blocked: String, allowed: String) =
        p(ctx).edit().putString(KEY_BLOCKED, blocked).putString(KEY_ALLOWED, allowed).apply()

    fun hasPin(ctx: Context) = p(ctx).contains(KEY_PIN_HASH)

    fun setPin(ctx: Context, pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val saltHex = salt.toHex()
        p(ctx).edit()
            .putString(KEY_PIN_SALT, saltHex)
            .putString(KEY_PIN_HASH, hash(saltHex, pin))
            .apply()
    }

    fun checkPin(ctx: Context, pin: String): Boolean {
        val prefs = p(ctx)
        val salt = prefs.getString(KEY_PIN_SALT, null) ?: return true
        val stored = prefs.getString(KEY_PIN_HASH, null) ?: return true
        return MessageDigest.isEqual(stored.toByteArray(), hash(salt, pin).toByteArray())
    }

    private fun hash(salt: String, pin: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        var data = (salt + pin).toByteArray()
        repeat(10_000) { data = md.digest(data) }
        return data.toHex()
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
}
