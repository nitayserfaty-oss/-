package com.shomer.einayim

import android.app.Activity
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog

object PinDialog {

    /** Runs [onOk] immediately if no PIN is set, otherwise after the correct PIN is entered. */
    fun requirePin(activity: Activity, onOk: () -> Unit) {
        if (!Prefs.hasPin(activity)) { onOk(); return }
        val input = pinField(activity)
        AlertDialog.Builder(activity)
            .setTitle(R.string.enter_pin)
            .setView(input)
            .setPositiveButton(R.string.ok) { _, _ ->
                if (Prefs.checkPin(activity, input.text.toString())) onOk()
                else Toast.makeText(activity, R.string.wrong_pin, Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    fun changePin(activity: Activity) = requirePin(activity) {
        val input = pinField(activity)
        AlertDialog.Builder(activity)
            .setTitle(R.string.new_pin)
            .setView(input)
            .setPositiveButton(R.string.ok) { _, _ ->
                val pin = input.text.toString()
                if (pin.length < 4) {
                    Toast.makeText(activity, R.string.pin_too_short, Toast.LENGTH_SHORT).show()
                } else {
                    Prefs.setPin(activity, pin)
                    Toast.makeText(activity, R.string.pin_saved, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun pinField(activity: Activity) = EditText(activity).apply {
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        val pad = (20 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad)
    }
}
