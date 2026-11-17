package com.investcalc.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Thin native shell around the offline web app (bundled in assets from investment-calculator/web).
 * All calculations run locally; the app needs no internet access.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        // Android 15 draws apps edge-to-edge: keep the page clear of the status bar and navigation bar.
        webView.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true      // localStorage: saved inputs & scenarios
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        webView.webChromeClient = WebChromeClient()   // enables confirm() dialogs
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "file") return false
                // open external links in the browser
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }
        }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    inner class Bridge {
        @JavascriptInterface
        fun share(text: String) {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
            runOnUiThread { startActivity(Intent.createChooser(send, getString(R.string.share_title))) }
        }
    }
}
