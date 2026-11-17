package com.shomer.einayim

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * A local-only VPN that captures DNS traffic, blocks immodest domains and
 * forwards everything else to a family-safe upstream resolver.
 * Regular (non-DNS) traffic is NOT routed through the VPN.
 */
class FilterVpnService : VpnService() {

    companion object {
        const val ACTION_START = "com.shomer.einayim.START"
        const val ACTION_STOP = "com.shomer.einayim.STOP"
        private const val TAG = "ShomerVpn"
        private const val CHANNEL = "filter"
        private const val NOTIF_ID = 1

        private const val VPN_ADDRESS = "10.111.222.2"
        private const val VPN_DNS = "10.111.222.1"

        /** Cloudflare for Families: blocks malware + adult content as a second layer. */
        private val UPSTREAMS = listOf("1.1.1.3", "1.0.0.3")

        @Volatile
        var isRunning = false
            private set

        fun start(ctx: Context) {
            val i = Intent(ctx, FilterVpnService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, FilterVpnService::class.java).setAction(ACTION_STOP))
        }
    }

    private var tun: ParcelFileDescriptor? = null
    private var readerThread: Thread? = null
    private var executor: ExecutorService? = null
    @Volatile
    private lateinit var blocklist: Blocklist
    private val rewriteCache = ConcurrentHashMap<String, Pair<Long, List<ByteArray>>>()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Prefs.setEnabled(this, false)
            shutdown()
            stopSelf()
            return START_NOT_STICKY
        }
        // Null intent / system "always-on" start / ACTION_START.
        // Re-reading the lists here also applies edits made in ListsActivity.
        Prefs.setEnabled(this, true)
        startInForeground()
        blocklist = Blocklist(Prefs.userBlocked(this), Prefs.userAllowed(this))
        if (tun == null) establish()
        return START_STICKY
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
            )
        }
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        val n = builder
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notif_text))
            .setSmallIcon(R.drawable.ic_shield)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun establish() {
        try {
            val builder = Builder()
                .setSession(getString(R.string.app_name))
                .addAddress(VPN_ADDRESS, 32)
                .addDnsServer(VPN_DNS)
                .addRoute(VPN_DNS, 32)
                .setBlocking(true)
            try {
                builder.addDisallowedApplication(packageName)
            } catch (_: Exception) {
            }
            val pfd = builder.establish() ?: run {
                Log.w(TAG, "establish() returned null (VPN permission missing)")
                stopSelf()
                return
            }
            tun = pfd
            isRunning = true
            executor = Executors.newFixedThreadPool(8)
            readerThread = Thread({ readLoop(pfd) }, "shomer-tun").also { it.start() }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to establish VPN", e)
            stopSelf()
        }
    }

    private fun readLoop(pfd: ParcelFileDescriptor) {
        val input = FileInputStream(pfd.fileDescriptor)
        val output = FileOutputStream(pfd.fileDescriptor)
        val buf = ByteArray(32767)
        try {
            while (!Thread.currentThread().isInterrupted) {
                val n = input.read(buf)
                if (n <= 0) continue
                val q = DnsPacket.parseIpv4(buf, n) ?: continue
                handleQuery(q, output)
            }
        } catch (e: Exception) {
            Log.i(TAG, "Reader stopped: ${e.message}")
        }
    }

    private fun handleQuery(q: DnsPacket.Query, out: FileOutputStream) {
        when (val v = blocklist.check(q.name)) {
            is Blocklist.Verdict.Block -> {
                write(out, DnsPacket.wrapReply(q, DnsPacket.emptyResponse(q, 3)))
                countBlocked()
            }
            is Blocklist.Verdict.Rewrite -> executor?.execute {
                val reply = if (q.qtype == DnsPacket.TYPE_A) {
                    val ips = resolveA(v.target)
                    if (ips.isEmpty()) DnsPacket.emptyResponse(q, 2) // SERVFAIL
                    else DnsPacket.aResponse(q, ips)
                } else {
                    // AAAA etc: answer empty so the client uses the IPv4 safe-search address
                    DnsPacket.emptyResponse(q, 0)
                }
                write(out, DnsPacket.wrapReply(q, reply))
            }
            is Blocklist.Verdict.Allow -> executor?.execute {
                val resp = forward(q.dns, q.dns.size)
                if (resp != null) write(out, DnsPacket.wrapReply(q, resp))
            }
        }
    }

    private fun resolveA(name: String): List<ByteArray> {
        val now = System.currentTimeMillis()
        rewriteCache[name]?.let { (ts, ips) -> if (now - ts < 10 * 60_000) return ips }
        val query = DnsPacket.buildQuery(name, Random.nextInt(0, 0xFFFF))
        val resp = forward(query, query.size) ?: return emptyList()
        val ips = DnsPacket.extractARecords(resp, resp.size)
        if (ips.isNotEmpty()) rewriteCache[name] = now to ips
        return ips
    }

    private fun forward(payload: ByteArray, len: Int): ByteArray? {
        for (server in UPSTREAMS) {
            var sock: DatagramSocket? = null
            try {
                sock = DatagramSocket()
                protect(sock)
                sock.soTimeout = 4000
                val addr = InetAddress.getByName(server)
                sock.send(DatagramPacket(payload, len, addr, 53))
                val rbuf = ByteArray(4096)
                val rp = DatagramPacket(rbuf, rbuf.size)
                sock.receive(rp)
                return rbuf.copyOf(rp.length)
            } catch (e: Exception) {
                Log.d(TAG, "Upstream $server failed: ${e.message}")
            } finally {
                sock?.close()
            }
        }
        return null
    }

    private fun write(out: FileOutputStream, packet: ByteArray) {
        try {
            synchronized(out) { out.write(packet) }
        } catch (e: Exception) {
            Log.d(TAG, "write failed: ${e.message}")
        }
    }

    private fun countBlocked() = Prefs.addBlocked(this, 1)

    private fun shutdown() {
        isRunning = false
        readerThread?.interrupt()
        readerThread = null
        try { tun?.close() } catch (_: Exception) {}
        tun = null
        executor?.shutdownNow()
        executor = null
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onRevoke() {
        // Another VPN took over or the user disconnected from system settings.
        shutdown()
        super.onRevoke()
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }
}
