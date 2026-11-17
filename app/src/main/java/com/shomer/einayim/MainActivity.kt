package com.shomer.einayim

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {

    private lateinit var status: TextView
    private lateinit var count: TextView
    private lateinit var toggle: MaterialButton
    private lateinit var shield: ImageView
    private val handler = Handler(Looper.getMainLooper())
    private val refresher = object : Runnable {
        override fun run() { refresh(); handler.postDelayed(this, 1500) }
    }

    private val vpnPermission = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) startFilter()
        else Toast.makeText(this, R.string.vpn_denied, Toast.LENGTH_LONG).show()
    }

    private val notifPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        count = findViewById(R.id.count)
        toggle = findViewById(R.id.toggle)
        shield = findViewById(R.id.shield)

        toggle.setOnClickListener {
            if (FilterVpnService.isRunning) {
                PinDialog.requirePin(this) { FilterVpnService.stop(this); refreshSoon() }
            } else {
                requestStart()
            }
        }
        findViewById<MaterialButton>(R.id.btnPin).setOnClickListener { PinDialog.changePin(this) }
        findViewById<MaterialButton>(R.id.btnLists).setOnClickListener {
            PinDialog.requirePin(this) { startActivity(Intent(this, ListsActivity::class.java)) }
        }
        findViewById<MaterialButton>(R.id.btnAlwaysOn).setOnClickListener {
            startActivity(Intent(Settings.ACTION_VPN_SETTINGS))
        }
        findViewById<MaterialButton>(R.id.btnAdmin).setOnClickListener { requestAdmin() }

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresher)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refresher)
    }

    private fun requestStart() {
        val intent = VpnService.prepare(this)
        if (intent != null) vpnPermission.launch(intent) else startFilter()
    }

    private fun startFilter() {
        FilterVpnService.start(this)
        refreshSoon()
    }

    private fun refreshSoon() = handler.postDelayed({ refresh() }, 600)

    private fun refresh() {
        val on = FilterVpnService.isRunning
        status.setText(if (on) R.string.status_on else R.string.status_off)
        status.setTextColor(getColor(if (on) R.color.on else R.color.off))
        shield.alpha = if (on) 1f else 0.35f
        toggle.setText(if (on) R.string.btn_stop else R.string.btn_start)
        toggle.setBackgroundColor(getColor(if (on) R.color.off else R.color.on))
        count.text = getString(R.string.blocked_count, Prefs.blockedCount(this))
    }

    private fun requestAdmin() {
        val dpm = getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(this, AdminReceiver::class.java)
        if (dpm.isAdminActive(admin)) {
            Toast.makeText(this, R.string.admin_explain, Toast.LENGTH_LONG).show()
            return
        }
        val i = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
            .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.admin_explain))
        startActivity(i)
    }
}
