package com.shomer.einayim

/**
 * Decides, for a given domain name, whether to block it, rewrite it to a
 * "safe search" endpoint, or let it through.
 */
class Blocklist(userBlocked: String, userAllowed: String) {

    sealed class Verdict {
        object Allow : Verdict()
        object Block : Verdict()
        data class Rewrite(val target: String) : Verdict()
    }

    private val userBlockedSet = parse(userBlocked)
    private val userAllowedSet = parse(userAllowed)

    fun check(rawDomain: String): Verdict {
        val domain = rawDomain.lowercase().trimEnd('.')
        if (domain.isEmpty()) return Verdict.Allow

        if (matchesSuffix(domain, userAllowedSet)) return Verdict.Allow
        if (matchesSuffix(domain, userBlockedSet)) return Verdict.Block

        safeSearchTarget(domain)?.let { return Verdict.Rewrite(it) }

        if (matchesSuffix(domain, BLOCKED_DOMAINS)) return Verdict.Block
        if (matchesSuffix(domain, BYPASS_DOMAINS)) return Verdict.Block
        if (matchesKeyword(domain)) return Verdict.Block
        return Verdict.Allow
    }

    private fun matchesKeyword(domain: String): Boolean {
        val tokens = domain.split('.', '-')
        for (t in tokens) {
            if (t.isEmpty()) continue
            for (k in KEYWORDS) if (t.contains(k)) return true
            if (t.contains("sex") && SEX_EXCEPTIONS.none { t.contains(it) }) return true
        }
        return false
    }

    companion object {
        fun matchesSuffix(domain: String, set: Set<String>): Boolean {
            var d = domain
            while (true) {
                if (d in set) return true
                val i = d.indexOf('.')
                if (i < 0) return false
                d = d.substring(i + 1)
            }
        }

        fun parse(text: String): Set<String> = text.lines()
            .map { it.trim().lowercase().removePrefix("http://").removePrefix("https://")
                .substringBefore('/').removePrefix("www.").trimEnd('.') }
            .filter { it.isNotEmpty() && it.contains('.') }
            .toSet()

        private val GOOGLE_RE = Regex("^(www\\.)?google\\.(com|[a-z]{2,3}|com?\\.[a-z]{2})$")

        fun safeSearchTarget(domain: String): String? = when {
            GOOGLE_RE.matches(domain) -> "forcesafesearch.google.com"
            domain in YOUTUBE -> "restrict.youtube.com"
            domain == "bing.com" || domain == "www.bing.com" -> "strict.bing.com"
            domain == "duckduckgo.com" || domain == "www.duckduckgo.com" -> "safe.duckduckgo.com"
            else -> null
        }

        private val YOUTUBE = setOf(
            "www.youtube.com", "m.youtube.com", "youtube.com",
            "youtubei.googleapis.com", "youtube.googleapis.com",
            "www.youtube-nocookie.com"
        )

        /** Substrings that, if present in any label of the domain, cause a block. */
        private val KEYWORDS = listOf(
            "porn", "xxx", "xvideo", "xnxx", "xhamster", "hentai", "nsfw",
            "camgirl", "webcamgirl", "sexcam", "livecam", "nude", "naked",
            "erotic", "erotik", "fetish", "milf", "redtube", "youporn",
            "brazzers", "chaturbate", "stripchat", "bongacams", "livejasmin",
            "camsoda", "onlyfans", "fansly", "playboy", "escort", "hookup",
            "adultfriend", "pussy", "boobs", "bdsm", "strip-club", "stripclub"
        )

        /** Legitimate words containing "sex" that must not be blocked. */
        private val SEX_EXCEPTIONS = listOf("sussex", "essex", "wessex", "middlesex", "sextant", "sexton")

        /** Known adult sites that don't necessarily contain a keyword. */
        private val BLOCKED_DOMAINS = setOf(
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com",
            "youporn.com", "tube8.com", "spankbang.com", "eporner.com", "txxx.com",
            "beeg.com", "tnaflix.com", "motherless.com", "hclips.com", "drtuber.com",
            "sunporno.com", "nuvid.com", "upornia.com", "hqporner.com", "porntrex.com",
            "thumbzilla.com", "4tube.com", "fapster.xxx", "efukt.com", "heavy-r.com",
            "ixxx.com", "rule34.xxx", "e-hentai.org", "nhentai.net", "gelbooru.com",
            "danbooru.donmai.us", "sankakucomplex.com", "f95zone.to", "literotica.com",
            "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com",
            "cam4.com", "camsoda.com", "myfreecams.com", "flirt4free.com", "imlive.com",
            "onlyfans.com", "fansly.com", "manyvids.com", "clips4sale.com", "iwantclips.com",
            "brazzers.com", "realitykings.com", "bangbros.com", "naughtyamerica.com",
            "mofos.com", "digitalplayground.com", "playboy.com", "hustler.com",
            "adultfriendfinder.com", "ashleymadison.com", "fling.com", "xmatch.com",
            "theporndude.com", "porn.com", "sex.com", "xxx.com", "youjizz.com",
            "slutload.com", "pornone.com", "fuq.com", "porndig.com", "pornoxo.com",
            "vporn.com", "tubegalore.com", "alohatube.com", "porngo.com", "anysex.com",
            "xozilla.com", "pornhat.com", "sxyprn.com", "daftsex.com", "javhd.com",
            "missav.com", "jable.tv", "avgle.com", "erome.com", "imagefap.com",
            "motherless.com", "scrolller.com", "redgifs.com", "fapello.com",
            "thothub.to", "coomer.su", "coomer.party", "kemono.su", "kemono.party",
            "simpcity.su", "leakedmodels.com", "porn300.com", "xxxbunker.com",
            "pornerbros.com", "keezmovies.com", "extremetube.com", "spankwire.com",
            "pornmd.com", "lobstertube.com", "porntube.com", "fux.com", "pornhd.com",
            "ok.xxx", "hdzog.com", "voyeurhit.com", "porn7.xxx", "perfectgirls.net",
            "xcafe.com", "nudevista.com", "sexvid.xxx", "freeones.com", "babepedia.com",
            "boobpedia.com", "iafd.com", "indexxx.com", "hotmovies.com", "adultempire.com",
            "pornpics.com", "pichunter.com", "sex-arab.com", "arabysexy.com"
        )

        /**
         * DNS-over-HTTPS providers. Blocking their hostnames forces browsers
         * to fall back to the system resolver (i.e. through this filter).
         * "use-application-dns.net" is Firefox's canary domain: NXDOMAIN
         * there tells Firefox to disable its built-in DoH.
         */
        private val BYPASS_DOMAINS = setOf(
            "use-application-dns.net", "dns.google", "dns.google.com",
            "cloudflare-dns.com", "mozilla.cloudflare-dns.com", "chrome.cloudflare-dns.com",
            "one.one.one.one", "1dot1dot1dot1.cloudflare-dns.com",
            "dns.quad9.net", "dns9.quad9.net", "doh.opendns.com", "doh.familyshield.opendns.com",
            "dns.adguard.com", "dns.adguard-dns.com", "dns.nextdns.io", "doh.cleanbrowsing.org",
            "doh.dns.sb", "dns.controld.com", "doh.mullvad.net", "dns.mullvad.net"
        )
    }
}
