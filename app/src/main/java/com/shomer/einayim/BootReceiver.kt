package com.shomer.einayim

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs.isEnabled(context) && VpnService.prepare(context) == null) {
            FilterVpnService.start(context)
        }
    }
}
