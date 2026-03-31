<template>
  <div class="qr-scanner-container">
    <el-radio-group v-if="!forceMode" v-model="scannerMode" class="mb-20 w-full flex flex-center" @change="handleModeChange">
      <el-radio-button label="camera">{{ $t('tools.scanner_camera') }}</el-radio-button>
      <el-radio-button label="image">{{ $t('tools.scanner_image') }}</el-radio-button>
    </el-radio-group>

    <!-- Camera Mode -->
    <div v-if="scannerMode === 'camera'" class="scan-area">
      <div class="video-wrapper" v-show="isScanning">
        <video ref="videoRef" class="video-preview" autoplay muted playsinline></video>
        <div class="scan-overlay">
          <div class="scan-line"></div>
        </div>
      </div>
      <div v-if="!isScanning" class="camera-placeholder" @click="toggleCamera">
        <el-icon :size="48" color="#909399"><Camera /></el-icon>
        <p>{{ $t('tools.camera_click_to_open') }}</p>
      </div>
      <el-button 
        :type="isScanning ? 'danger' : 'primary'" 
        @click="toggleCamera" 
        class="mt-30 w-full" 
        :loading="isStarting"
        size="large"
      >
        {{ isScanning ? $t('tools.camera_stop') : $t('tools.camera_open') }}
      </el-button>
    </div>

    <!-- Image Mode -->
    <div v-else class="upload-area">
      <div class="image-preview" @click="triggerFileUpload">
        <img v-if="previewImg" :src="previewImg" class="preview-img" />
        <div v-else class="upload-placeholder">
          <el-icon :size="48" color="#909399"><Picture /></el-icon>
          <p>{{ $t('tools.image_placeholder') }}</p>
        </div>
      </div>
      <input type="file" ref="fileInputRef" accept="image/*" class="display-none" @change="handleFileUpload" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { Camera, Picture, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import jsQR from 'jsqr'
import { i18n } from '@/locales'

const props = defineProps({
  forceMode: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['scan-success'])
const { t } = i18n.global

const scannerMode = ref(props.forceMode || 'camera')

watch(() => props.forceMode, (newMode) => {
  if (newMode) {
    if (scannerMode.value === 'camera' && newMode !== 'camera') {
       stopCamera()
    }
    scannerMode.value = newMode
  }
})
const videoRef = ref(null)
const fileInputRef = ref(null)
const isScanning = ref(false)
const isStarting = ref(false)
const previewImg = ref('')

let stream = null
let scanInterval = null

const handleModeChange = () => {
  if (scannerMode.value !== 'camera') {
    stopCamera()
  }
}

const toggleCamera = () => {
  if (isScanning.value) {
    stopCamera()
  } else {
    startCamera()
  }
}

const startCamera = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ElMessage.error(t('tools.camera_unsupported'))
    return
  }
  
  isStarting.value = true
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' } // 优先调用后置摄像头
    })
    
    await nextTick()
    if (videoRef.value) {
      videoRef.value.srcObject = stream
      
      videoRef.value.onloadedmetadata = () => {
        videoRef.value.play()
        isScanning.value = true
        isStarting.value = false
        scanInterval = setInterval(scanVideoFrame, 500) // 每半秒截取一帧分析
      }
    }
  } catch (err) {
    isStarting.value = false
    ElMessage.error(t('tools.camera_access_denied'))
    console.error('Camera error:', err)
  }
}

const stopCamera = () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop())
    stream = null
  }
  if (scanInterval) {
    clearInterval(scanInterval)
    scanInterval = null
  }
  isScanning.value = false
  isStarting.value = false
}

// 抽取视频帧进行二维码解析
const scanVideoFrame = () => {
  if (!videoRef.value || videoRef.value.readyState !== videoRef.value.HAVE_ENOUGH_DATA) return
  
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  
  canvas.width = videoRef.value.videoWidth
  canvas.height = videoRef.value.videoHeight
  ctx.drawImage(videoRef.value, 0, 0, canvas.width, canvas.height)
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height)
  
  // 以前限制了 code.data.startsWith('otpauth://')，既然变成了 shared 基础组件，就不应该做这个判定
  if (code && code.data) {
    stopCamera() // 扫到了就马上关掉摄像头
    emit('scan-success', code.data) 
  }
}

const triggerFileUpload = () => {
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

const handleFileUpload = (e) => {
  const file = e.target.files[0]
  if (!file) return
  
  // 生成预览
  previewImg.value = URL.createObjectURL(file)

  const reader = new FileReader()
  reader.onload = (event) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      
      if (code && code.data) {
        emit('scan-success', code.data)
      } else {
        ElMessage.error(t('tools.qr_not_recognized'))
      }
    }
    img.src = event.target.result
  }
  reader.readAsDataURL(file)
  e.target.value = '' // 清空 input，允许重复上传同一张图片
}

onBeforeUnmount(() => {
  stopCamera()
  if (previewImg.value) {
    URL.revokeObjectURL(previewImg.value)
  }
})
</script>