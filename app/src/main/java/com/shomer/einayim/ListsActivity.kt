package com.shomer.einayim

import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton

class ListsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_lists)
        val blocked = findViewById<EditText>(R.id.blocked)
        val allowed = findViewById<EditText>(R.id.allowed)
        blocked.setText(Prefs.userBlocked(this))
        allowed.setText(Prefs.userAllowed(this))

        findViewById<MaterialButton>(R.id.save).setOnClickListener {
            Prefs.setLists(this, blocked.text.toString(), allowed.text.toString())
            // Re-sending START makes the running service reload the lists.
            if (FilterVpnService.isRunning) FilterVpnService.start(this)
            Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
