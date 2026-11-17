plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.investcalc.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.investcalc.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // The app UI is the web app in /investment-calculator/web, bundled as assets.
    sourceSets {
        getByName("main") {
            assets.srcDirs("../investment-calculator/web")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
