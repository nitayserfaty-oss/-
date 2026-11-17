package com.shomer.einayim

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterLogicTest {
    private val list = Blocklist("badsite.org\n", "goodporn-research.edu\n")

    @Test fun blocksKnownAndKeywordDomains() {
        assertEquals(Blocklist.Verdict.Block, list.check("www.pornhub.com"))
        assertEquals(Blocklist.Verdict.Block, list.check("cdn.xvideos-cdn.com"))
        assertEquals(Blocklist.Verdict.Block, list.check("free-sexcam.net"))
        assertEquals(Blocklist.Verdict.Block, list.check("sub.badsite.org"))
        assertEquals(Blocklist.Verdict.Block, list.check("dns.google"))
    }

    @Test fun allowsNormalDomains() {
        assertEquals(Blocklist.Verdict.Allow, list.check("www.wikipedia.org"))
        assertEquals(Blocklist.Verdict.Allow, list.check("www.sussex.ac.uk"))
        assertEquals(Blocklist.Verdict.Allow, list.check("mail.google.com"))
        assertEquals(Blocklist.Verdict.Allow, list.check("goodporn-research.edu"))
    }

    @Test fun rewritesSafeSearch() {
        assertEquals(Blocklist.Verdict.Rewrite("forcesafesearch.google.com"), list.check("www.google.co.il"))
        assertEquals(Blocklist.Verdict.Rewrite("forcesafesearch.google.com"), list.check("google.com"))
        assertEquals(Blocklist.Verdict.Rewrite("restrict.youtube.com"), list.check("m.youtube.com"))
        assertEquals(Blocklist.Verdict.Rewrite("strict.bing.com"), list.check("www.bing.com"))
    }

    @Test fun parsesQueryAndBuildsReplies() {
        val dns = DnsPacket.buildQuery("www.example.com", 0x1234)
        val ip = ByteArray(28 + dns.size)
        ip[0] = 0x45; ip[9] = 17
        byteArrayOf(10, 111, 222.toByte(), 2).copyInto(ip, 12)
        byteArrayOf(10, 111, 222.toByte(), 1).copyInto(ip, 16)
        ip[20] = 0xC3.toByte(); ip[21] = 0x50          // src port 50000
        ip[23] = 53
        ip[24] = ((8 + dns.size) shr 8).toByte(); ip[25] = (8 + dns.size).toByte()
        dns.copyInto(ip, 28)

        val q = DnsPacket.parseIpv4(ip, ip.size)
        assertNotNull(q)
        q!!
        assertEquals("www.example.com", q.name)
        assertEquals(DnsPacket.TYPE_A, q.qtype)

        val nx = DnsPacket.emptyResponse(q, 3)
        assertEquals(0x12, nx[0].toInt()); assertEquals(0x34, nx[1].toInt())
        assertEquals(3, nx[3].toInt() and 0xF)

        val answer = DnsPacket.aResponse(q, listOf(byteArrayOf(1, 2, 3, 4)))
        val ips = DnsPacket.extractARecords(answer, answer.size)
        assertEquals(1, ips.size)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), ips[0])

        val reply = DnsPacket.wrapReply(q, nx)
        assertEquals(53, reply[21].toInt())                       // src port 53
        assertTrue(reply.copyOfRange(16, 20).contentEquals(q.srcIp)) // back to client
    }
}
