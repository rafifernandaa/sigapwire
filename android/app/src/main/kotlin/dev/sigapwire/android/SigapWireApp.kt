package dev.sigapwire.android

import android.app.Application
import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.firestore.firestore
import com.google.firebase.firestore.firestoreSettings
import com.google.firebase.firestore.persistentCacheSettings

class SigapWireApp : Application() {
    override fun onCreate() {
        super.onCreate()
        isFirebaseConfigured = initializeFirebaseSafely()
    }

    private fun initializeFirebaseSafely(): Boolean {
        return try {
            val initialized = FirebaseApp.getApps(this).isNotEmpty() ||
                FirebaseApp.initializeApp(this) != null
            if (!initialized) {
                false
            } else {
                Firebase.appCheck.installAppCheckProviderFactory(
                    DebugAppCheckProviderFactory.getInstance()
                )
                Firebase.firestore.firestoreSettings = firestoreSettings {
                    setLocalCacheSettings(persistentCacheSettings {})
                }
                true
            }
        } catch (_: Throwable) {
            false
        }
    }

    companion object {
        @Volatile
        var isFirebaseConfigured: Boolean = false
            private set
    }
}
