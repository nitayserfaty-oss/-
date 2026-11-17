package com.shomer.einayim

import java.io.ByteArrayOutputStream

/** Minimal IPv4/UDP/DNS parsing and construction utilities. */
object DnsPacket {

    class Query(
        val srcIp: ByteArray,
        val dstIp: ByteArray,
        val srcPort: Int,
        val dstPort: Int,
        val dns: ByteArray,
        val name: String,
        val qtype: Int,
        /** Offset in [dns] just past the question section. */
        val questionEnd: Int
    )

    const val TYPE_A = 1

    /** Parse an IPv4 packet read from the tun device. Returns null if it's not a DNS query. */
    fun parseIpv4(packet: ByteArray, length: Int): Query? {
        if (length < 28) return null
        val version = (packet[0].toInt() shr 4) and 0xF
        if (version != 4) return null
        val ihl = (packet[0].toInt() and 0xF) * 4
        if (packet[9].toInt() != 17) return null // UDP only
        if (length < ihl + 8 + 12) return null
        val srcIp = packet.copyOfRange(12, 16)
        val dstIp = packet.copyOfRange(16, 20)
        val srcPort = u16(packet, ihl)
        val dstPort = u16(packet, ihl + 2)
        if (dstPort != 53) return null
        val udpLen = u16(packet, ihl + 4)
        val payloadLen = minOf(udpLen - 8, length - ihl - 8)
        if (payloadLen < 12) return null
        val dns = packet.copyOfRange(ihl + 8, ihl + 8 + payloadLen)
        return parseDnsQuestion(dns)?.let { (name, qtype, end) ->
            Query(srcIp, dstIp, srcPort, dstPort, dns, name, qtype, end)
        }
    }

    private fun parseDnsQuestion(dns: ByteArray): Triple<String, Int, Int>? {
        val qdcount = u16(dns, 4)
        if (qdcount < 1) return null
        val sb = StringBuilder()
        var pos = 12
        while (true) {
            if (pos >= dns.size) return null
            val len = dns[pos].toInt() and 0xFF
            if (len == 0) { pos++; break }
            if (len and 0xC0 != 0) return null // no compression in questions
            if (pos + 1 + len > dns.size) return null
            if (sb.isNotEmpty()) sb.append('.')
            for (i in 0 until len) sb.append((dns[pos + 1 + i].toInt() and 0xFF).toChar())
            pos += 1 + len
        }
        if (pos + 4 > dns.size) return null
        val qtype = u16(dns, pos)
        return Triple(sb.toString(), qtype, pos + 4)
    }

    /** DNS response with no answers. rcode 3 = NXDOMAIN, 0 = NOERROR. */
    fun emptyResponse(q: Query, rcode: Int): ByteArray {
        val out = q.dns.copyOfRange(0, q.questionEnd)
        val rd = out[2].toInt() and 0x01
        out[2] = (0x80 or rd).toByte()          // QR=1, opcode 0, RD copied
        out[3] = (0x80 or (rcode and 0xF)).toByte() // RA=1
        out[4] = 0; out[5] = 1                   // QDCOUNT=1
        for (i in 6..11) out[i] = 0              // AN/NS/AR = 0
        return out
    }

    /** Response for an A query answering with the given IPv4 addresses. */
    fun aResponse(q: Query, ips: List<ByteArray>): ByteArray {
        val bos = ByteArrayOutputStream()
        val header = emptyResponse(q, 0)
        header[6] = (ips.size shr 8).toByte()
        header[7] = ips.size.toByte()
        bos.write(header)
        for (ip in ips) {
            bos.write(byteArrayOf(0xC0.toByte(), 0x0C))  // pointer to question name
            bos.write(byteArrayOf(0, 1, 0, 1))           // TYPE A, CLASS IN
            bos.write(byteArrayOf(0, 0, 0x01, 0x2C))     // TTL 300
            bos.write(byteArrayOf(0, 4))
            bos.write(ip)
        }
        return bos.toByteArray()
    }

    /** Build a standalone A query for [name]. */
    fun buildQuery(name: String, id: Int): ByteArray {
        val bos = ByteArrayOutputStream()
        bos.write(byteArrayOf((id shr 8).toByte(), id.toByte(), 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0))
        for (label in name.split('.')) {
            bos.write(label.length)
            bos.write(label.toByteArray(Charsets.US_ASCII))
        }
        bos.write(byteArrayOf(0, 0, 1, 0, 1))
        return bos.toByteArray()
    }

    /** Extract all A-record IPs from a DNS response. */
    fun extractARecords(resp: ByteArray, len: Int): List<ByteArray> {
        val result = ArrayList<ByteArray>()
        try {
            if (len < 12) return result
            val qd = u16(resp, 4)
            val an = u16(resp, 6)
            var pos = 12
            repeat(qd) { pos = skipName(resp, pos) + 4 }
            repeat(an) {
                pos = skipName(resp, pos)
                val type = u16(resp, pos)
                val rdlen = u16(resp, pos + 8)
                pos += 10
                if (type == TYPE_A && rdlen == 4 && pos + 4 <= len) {
                    result.add(resp.copyOfRange(pos, pos + 4))
                }
                pos += rdlen
            }
        } catch (_: IndexOutOfBoundsException) {
        }
        return result
    }

    private fun skipName(b: ByteArray, start: Int): Int {
        var pos = start
        while (true) {
            val len = b[pos].toInt() and 0xFF
            if (len == 0) return pos + 1
            if (len and 0xC0 == 0xC0) return pos + 2
            pos += 1 + len
        }
    }

    /** Wrap a DNS payload in IPv4+UDP headers, as a reply to [q]. */
    fun wrapReply(q: Query, payload: ByteArray): ByteArray {
        val total = 20 + 8 + payload.size
        val p = ByteArray(total)
        p[0] = 0x45
        p[2] = (total shr 8).toByte(); p[3] = total.toByte()
        p[6] = 0x40 // don't fragment
        p[8] = 64   // TTL
        p[9] = 17   // UDP
        System.arraycopy(q.dstIp, 0, p, 12, 4)
        System.arraycopy(q.srcIp, 0, p, 16, 4)
        val cs = ipChecksum(p, 20)
        p[10] = (cs shr 8).toByte(); p[11] = cs.toByte()
        p[20] = (q.dstPort shr 8).toByte(); p[21] = q.dstPort.toByte()
        p[22] = (q.srcPort shr 8).toByte(); p[23] = q.srcPort.toByte()
        val udpLen = 8 + payload.size
        p[24] = (udpLen shr 8).toByte(); p[25] = udpLen.toByte()
        // UDP checksum 0 = not computed (valid for IPv4)
        System.arraycopy(payload, 0, p, 28, payload.size)
        return p
    }

    private fun ipChecksum(b: ByteArray, len: Int): Int {
        var sum = 0
        var i = 0
        while (i < len) {
            sum += u16(b, i)
            i += 2
        }
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }

    private fun u16(b: ByteArray, off: Int) =
        ((b[off].toInt() and 0xFF) shl 8) or (b[off + 1].toInt() and 0xFF)
}
