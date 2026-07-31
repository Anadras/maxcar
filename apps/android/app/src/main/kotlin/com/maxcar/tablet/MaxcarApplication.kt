package com.maxcar.tablet

import android.app.Application
import com.maxcar.tablet.di.AppContainer

class MaxcarApplication : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
