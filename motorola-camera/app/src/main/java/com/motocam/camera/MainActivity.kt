package com.motocam.camera

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Camera simples: foto e video. SEMPRE abre em modo video, qualquer que seja
 * o intent que o sistema usou (atalho do botao liga/desliga, icone, etc.).
 */
class MainActivity : AppCompatActivity() {

    private enum class Mode { VIDEO, PHOTO }

    private lateinit var previewView: PreviewView
    private lateinit var captureButton: Button
    private lateinit var modeButton: Button
    private lateinit var switchButton: Button
    private lateinit var timerText: TextView
    private lateinit var dimButton: Button
    private lateinit var dimOverlay: View
    private lateinit var dimDot: View
    private var dimmed = false

    private var cameraProvider: ProcessCameraProvider? = null
    private var imageCapture: ImageCapture? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null

    private var mode = Mode.VIDEO
    private var lensFacing = CameraSelector.LENS_FACING_BACK

    private val handler = Handler(Looper.getMainLooper())
    private var recordStart = 0L
    private val timerTick = object : Runnable {
        override fun run() {
            val s = (SystemClock.elapsedRealtime() - recordStart) / 1000
            timerText.text = String.format(Locale.US, "%02d:%02d", s / 60, s % 60)
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        previewView = findViewById(R.id.preview)
        captureButton = findViewById(R.id.captureButton)
        modeButton = findViewById(R.id.modeButton)
        switchButton = findViewById(R.id.switchButton)
        timerText = findViewById(R.id.timer)

        dimButton = findViewById(R.id.dimButton)
        dimOverlay = findViewById(R.id.dimOverlay)
        dimDot = findViewById(R.id.dimDot)

        dimButton.setOnClickListener { setDimmed(true) }
        // Segurar para sair evita sair sem querer com o suporte no peito.
        dimOverlay.setOnLongClickListener {
            setDimmed(false)
            true
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (dimmed) {
                        setDimmed(false)
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )

        captureButton.setOnClickListener { onCaptureClicked() }
        modeButton.setOnClickListener { toggleMode() }
        switchButton.setOnClickListener { switchCamera() }

        if (hasPermissions()) {
            startCamera()
        } else {
            requestPermissions(PERMISSIONS, REQUEST_CODE)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        // Atalho acionado com o app ja aberto: volta para o modo video.
        if (recording == null && mode != Mode.VIDEO) {
            mode = Mode.VIDEO
            bindUseCases()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE) {
            if (hasPermissions()) {
                startCamera()
            } else {
                Toast.makeText(this, R.string.permission_needed, Toast.LENGTH_LONG).show()
            }
        }
    }

    /**
     * Botoes de volume (+ ou -) funcionam como o botao de gravar: comecam e
     * param o video (ou tiram foto, no modo foto). Funciona com tela escura.
     */
    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ||
            keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN
        ) {
            if (event.repeatCount == 0 && cameraProvider != null) onCaptureClicked()
            return true // consome o evento: nao muda o volume
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ||
            keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN
        ) {
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onStop() {
        super.onStop()
        // Finaliza a gravacao com seguranca se o app sair da tela.
        stopRecording()
        setDimmed(false)
    }

    /**
     * Tela escura: cobre a tela de preto e leva o brilho ao minimo para
     * economizar bateria. A gravacao continua; a tela segue "acordada"
     * (FLAG_KEEP_SCREEN_ON), senao o Android pausaria o app.
     */
    private fun setDimmed(on: Boolean) {
        if (dimmed == on) return
        dimmed = on
        val attrs = window.attributes
        attrs.screenBrightness = if (on) {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_OFF
        } else {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        }
        window.attributes = attrs
        dimOverlay.visibility = if (on) View.VISIBLE else View.GONE
        if (on) toast(getString(R.string.dim_hint))
        updateUi()
    }

    private fun hasPermissions() = PERMISSIONS.all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            cameraProvider = future.get()
            bindUseCases()
            if (AUTO_START_RECORDING && mode == Mode.VIDEO && recording == null) {
                startRecording()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun bindUseCases() {
        val provider = cameraProvider ?: return
        val rotation = previewView.display?.rotation ?: android.view.Surface.ROTATION_0

        val preview = Preview.Builder().setTargetRotation(rotation).build()
            .also { it.setSurfaceProvider(previewView.surfaceProvider) }

        val selector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
        provider.unbindAll()
        try {
            if (mode == Mode.VIDEO) {
                val recorder = Recorder.Builder()
                    .setQualitySelector(
                        QualitySelector.from(
                            Quality.FHD,
                            FallbackStrategy.lowerQualityOrHigherThan(Quality.SD),
                        ),
                    )
                    .build()
                videoCapture = VideoCapture.withOutput(recorder).also {
                    it.targetRotation = rotation
                }
                imageCapture = null
                provider.bindToLifecycle(this, selector, preview, videoCapture!!)
            } else {
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setTargetRotation(rotation)
                    .build()
                videoCapture = null
                provider.bindToLifecycle(this, selector, preview, imageCapture!!)
            }
        } catch (e: Exception) {
            toast(getString(R.string.error_generic, e.message ?: "camera"))
        }
        updateUi()
    }

    private fun onCaptureClicked() {
        if (mode == Mode.VIDEO) {
            if (recording == null) startRecording() else stopRecording()
        } else {
            takePhoto()
        }
    }

    private fun toggleMode() {
        if (recording != null) return
        mode = if (mode == Mode.VIDEO) Mode.PHOTO else Mode.VIDEO
        bindUseCases()
    }

    private fun switchCamera() {
        if (recording != null) return
        lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) {
            CameraSelector.LENS_FACING_FRONT
        } else {
            CameraSelector.LENS_FACING_BACK
        }
        bindUseCases()
    }

    private fun startRecording() {
        val vc = videoCapture ?: return
        if (recording != null) return

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "VID_${timestamp()}")
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Movies/MotoCam")
        }
        val output = MediaStoreOutputOptions.Builder(
            contentResolver,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
        ).setContentValues(values).build()

        var pending = vc.output.prepareRecording(this, output)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            pending = pending.withAudioEnabled()
        }

        recording = pending.start(ContextCompat.getMainExecutor(this)) { event ->
            when (event) {
                is VideoRecordEvent.Start -> {
                    recordStart = SystemClock.elapsedRealtime()
                    handler.post(timerTick)
                    updateUi()
                }
                is VideoRecordEvent.Finalize -> {
                    handler.removeCallbacks(timerTick)
                    recording = null
                    if (event.hasError()) {
                        toast(getString(R.string.error_generic, "video ${event.error}"))
                    } else {
                        toast(getString(R.string.saved_video))
                    }
                    updateUi()
                }
                else -> Unit
            }
        }
        updateUi()
    }

    private fun stopRecording() {
        recording?.stop()
    }

    private fun takePhoto() {
        val ic = imageCapture ?: return
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "IMG_${timestamp()}")
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/MotoCam")
        }
        val options = ImageCapture.OutputFileOptions.Builder(
            contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values,
        ).build()

        ic.takePicture(
            options,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                    toast(getString(R.string.saved_photo))
                }

                override fun onError(e: ImageCaptureException) {
                    toast(getString(R.string.error_generic, e.message ?: "foto"))
                }
            },
        )
    }

    private fun updateUi() {
        val recordingNow = recording != null
        dimDot.visibility = if (dimmed && recordingNow) View.VISIBLE else View.GONE
        timerText.visibility = if (recordingNow) View.VISIBLE else View.GONE
        if (!recordingNow) timerText.text = "00:00"
        modeButton.isEnabled = !recordingNow
        switchButton.isEnabled = !recordingNow
        modeButton.setText(if (mode == Mode.VIDEO) R.string.mode_photo else R.string.mode_video)
        captureButton.alpha = if (recordingNow) 0.6f else 1f
        captureButton.contentDescription = when {
            mode == Mode.PHOTO -> "Tirar foto"
            recordingNow -> "Parar gravacao"
            else -> "Gravar"
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun timestamp(): String =
        SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(System.currentTimeMillis())

    companion object {
        private const val REQUEST_CODE = 10

        /** Se true, comeca a gravar sozinho assim que o app abre. */
        private const val AUTO_START_RECORDING = false

        private val PERMISSIONS = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
        )
    }
}
