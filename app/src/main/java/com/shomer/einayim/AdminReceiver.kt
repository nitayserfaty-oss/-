package com.shomer.einayim

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/** Being a device admin prevents uninstalling the app until admin is disabled. */
class AdminReceiver : DeviceAdminReceiver() {
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        context.getString(R.string.admin_disable_warning)
}
