package com.maxcar.tablet

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.ui.enrollment.EnrollmentScreen
import com.maxcar.tablet.ui.enrollment.EnrollmentViewModel
import com.maxcar.tablet.ui.home.DeviceHomeScreen
import com.maxcar.tablet.ui.home.DeviceHomeViewModel
import com.maxcar.tablet.ui.theme.MaxcarTheme
import com.maxcar.tablet.work.DeviceTelemetry

class MainActivity : ComponentActivity() {

    private val repository: DeviceRepository
        get() = (application as MaxcarApplication).container.deviceRepository

    private val enrollmentViewModel: EnrollmentViewModel by viewModels {
        EnrollmentViewModel.Factory(repository, applicationContext) {
            // The isEnrolled flow (observed in MaxcarApp below) drives the
            // screen switch; nothing else to do here on success.
        }
    }

    private val homeViewModel: DeviceHomeViewModel by viewModels {
        DeviceHomeViewModel.Factory(repository) { DeviceTelemetry.collect(applicationContext) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaxcarTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MaxcarApp(
                        repository = repository,
                        enrollmentViewModel = enrollmentViewModel,
                        homeViewModel = homeViewModel,
                    )
                }
            }
        }
    }
}

@Composable
private fun MaxcarApp(
    repository: DeviceRepository,
    enrollmentViewModel: EnrollmentViewModel,
    homeViewModel: DeviceHomeViewModel,
) {
    val isEnrolled by repository.isEnrolled.collectAsState(initial = null)
    when (isEnrolled) {
        null -> Unit // Still reading DataStore; avoid a enrollment/home flash.
        true -> DeviceHomeScreen(homeViewModel)
        false -> EnrollmentScreen(enrollmentViewModel)
    }
}
