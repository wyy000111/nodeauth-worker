<template>
  <div class="backup-container">
    <!-- 顶部操作 -->
    <div class="backup-header-actions">
      <h3>{{ $t('backup.management') }}</h3>
      <el-button type="primary" @click="openAddDialog" :disabled="layoutStore.isOffline">
        <el-icon><Plus /></el-icon> {{ $t('backup.add_provider') }}
      </el-button>
    </div>

    <!-- 全局加载状态 -->
    <div v-if="isLoading && providers.length === 0" class="flex-column flex-center min-h-200 text-secondary">
      <el-icon class="is-loading mb-20 text-primary" :size="48"><Loading /></el-icon>
      <p class="text-16 ls-1">{{ $t('backup.fetching_sources') }}</p>
    </div>

    <!-- 列表区域 (有数据情况) -->
    <el-row v-else-if="providers.length > 0" :gutter="20">
      <el-col :xs="24" :sm="12" :md="8" v-for="provider in providers" :key="provider.id" class="mb-20">
        <el-card shadow="hover" class="backup-provider-card">
          <template #header>
            <div class="backup-card-header">
              <div class="flex flex-items-center">
                <div class="backup-provider-title flex-wrap">
                  <el-tag size="small" effect="dark" :type="getProviderTypeTag(provider.type)">{{ provider.type.toUpperCase() }}</el-tag>
                  <span class="font-bold text-16">{{ provider.name }}</span>
                  <el-tooltip v-if="provider.auto_backup" :content="$t('backup.auto_backup_on')" placement="top">
                    <el-icon color="#67C23A" size="16" class="pointer-help"><Timer /></el-icon>
                  </el-tooltip>
                </div>
              </div>
              <div class="provider-actions">
                <el-button link type="primary" @click="editProvider(provider)" :disabled="layoutStore.isOffline"><el-icon><Edit /></el-icon></el-button>
                <el-button link type="danger" @click="deleteProvider(provider)" :disabled="layoutStore.isOffline"><el-icon><Delete /></el-icon></el-button>
              </div>
            </div>
          </template>
          
          <div class="card-content">
            <p class="backup-status-text">
              {{ $t('backup.last_backup') }} 
              <span v-if="provider.lastBackupAt">{{ formatDate(provider.lastBackupAt) }}</span>
              <span v-else>{{ $t('backup.never_backed_up') }}</span>
              <el-tag v-if="provider.lastBackupStatus" size="small" :type="provider.lastBackupStatus === 'success' ? 'success' : 'danger'" class="ml-5">
                {{ provider.lastBackupStatus }}
              </el-tag>
            </p>

            <div class="backup-action-buttons">
              <el-button
                plain size="small"
                :type="testResults[provider.id] === 'error' ? 'danger' : 'primary'"
                :loading="!!testingProviderIds[provider.id]"
                :disabled="testResults[provider.id] === 'success' || layoutStore.isOffline"
                :class="{ 'btn-test-success': testResults[provider.id] === 'success' }"
                @click="testConnection(provider)"
              >
                <el-icon v-if="testResults[provider.id] === 'success'" color="#67C23A" style="margin-right: 4px;">
                  <CircleCheck />
                </el-icon>
                <el-icon v-else-if="testResults[provider.id] === 'error'" style="margin-right: 4px;">
                  <CircleClose />
                </el-icon>
                {{ testResults[provider.id] === 'success' ? $t('backup.connection_normal') : (testResults[provider.id] === 'error' ? $t('backup.connection_failed') : $t('backup.test_connection')) }}
              </el-button>
              <el-button
                type="success" plain size="small"
                :loading="checkingBackupProviderId === provider.id"
                :disabled="layoutStore.isOffline"
                @click="openBackupDialog(provider)"
              >{{ $t('backup.backup_now') }}</el-button>
              <el-button
                type="warning" plain size="small"
                :loading="checkingRestoreProviderId === provider.id"
                :disabled="layoutStore.isOffline"
                @click="openRestoreDialog(provider)"
              >{{ $t('backup.restore_data') }}</el-button>
            </div>
          </div>
        </el-card>
      </el-col>
      
    </el-row>

    <!-- 空状态 -->
    <div v-else class="empty-state mt-40">
      <el-empty :description="$t('backup.empty_provider')" />
    </div>

    <!-- 编辑弹窗 -->
    <ResponsiveOverlay v-model="showConfigDialog" :title="isEditing ? $t('backup.edit_provider') : $t('backup.add_provider')" width="500px">


      <el-form :model="form" label-position="top" ref="formRef">
        <el-form-item :label="$t('backup.type_label')">
          <el-select v-model="form.type" :placeholder="$t('backup.select_type')" class="w-full" :disabled="isEditing" :teleported="false">
            <el-option v-if="availableTypes.includes('email')" :label="$t('backup.type_email')" value="email" />
            <el-option v-if="availableTypes.includes('s3')" :label="$t('backup.type_s3')" value="s3" />
            <el-option v-if="availableTypes.includes('webdav')" :label="$t('backup.type_webdav')" value="webdav" />
            <el-option v-if="availableTypes.includes('telegram')" :label="$t('backup.type_telegram')" value="telegram" />
            <el-option v-if="availableTypes.includes('github')" :label="$t('backup.type_github')" value="github" />
            <el-option v-if="availableTypes.includes('gdrive')" :label="$t('backup.type_gdrive')" value="gdrive" />
            <el-option v-if="availableTypes.includes('onedrive')" :label="$t('backup.type_onedrive')" value="onedrive" />
            <el-option v-if="availableTypes.includes('dropbox')" :label="$t('backup.type_dropbox')" value="dropbox" />
            <el-option v-if="availableTypes.includes('baidu')" :label="$t('backup.type_baidu')" value="baidu" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('backup.name_label')">
          <el-input v-model="form.name" :placeholder="$t('backup.name_placeholder')" />
        </el-form-item>

        <!-- S3 配置 -->
        <template v-if="form.type === 's3'">
          <el-form-item :label="$t('backup.s3_endpoint')">
            <el-input v-model="form.config.endpoint" placeholder="https://<account>.r2.cloudflarestorage.com" />
          </el-form-item>
          <el-form-item :label="$t('backup.s3_bucket')">
            <el-input v-model="form.config.bucket" placeholder="my-backup-bucket" />
          </el-form-item>
          <el-form-item :label="$t('backup.s3_region')">
            <el-input v-model="form.config.region" :placeholder="$t('backup.s3_region_placeholder')" />
          </el-form-item>
          <el-form-item label="Access Key ID">
            <el-input v-model="form.config.accessKeyId" />
          </el-form-item>
          <el-form-item label="Secret Access Key">
            <div v-if="isEditing && !isEditingS3Secret" class="flex flex-items-center flex-between bg-fill p-10 rounded-4 border-1 w-full h-32">
              <span class="font-mono ls-2">******</span>
              <el-button link type="primary" @click="isEditingS3Secret = true; form.config.secretAccessKey = ''">{{ $t('backup.modify') }}</el-button>
            </div>
            <el-input v-else v-model="form.config.secretAccessKey" type="password" show-password />
          </el-form-item>
          <el-form-item :label="$t('backup.s3_path_prefix')">
            <el-input v-model="form.config.saveDir" placeholder="/nodeauth-backup" />
          </el-form-item>
        </template>

        <!-- Telegram 配置 -->
        <template v-if="form.type === 'telegram'">
          <el-form-item :label="$t('backup.telegram_bot_token')">
            <div v-if="isEditing && !isEditingTelegramToken" class="flex flex-items-center flex-between bg-fill p-10 rounded-4 border-1 w-full h-32">
              <span class="font-mono ls-2">******</span>
              <el-button link type="primary" @click="isEditingTelegramToken = true; form.config.botToken = ''">{{ $t('backup.modify') }}</el-button>
            </div>
            <el-input v-else v-model="form.config.botToken" type="password" show-password :placeholder="$t('backup.telegram_bot_token_placeholder')" />
          </el-form-item>
          <el-form-item :label="$t('backup.telegram_chat_id')">
            <el-input v-model="form.config.chatId" :placeholder="$t('backup.telegram_chat_id_placeholder')" />
            <div class="backup-form-tip">
              <strong>{{ $t('backup.telegram_chat_id_tip_title') }}</strong><br/>
              <span>{{ $t('backup.telegram_chat_id_tip_1') }}</span><br/>
              <span>{{ $t('backup.telegram_chat_id_tip_2') }}</span>
            </div>
          </el-form-item>
        </template>

        <!-- WebDAV 配置 -->
        <template v-if="form.type === 'webdav'">
          <el-form-item :label="$t('backup.webdav_url')">
            <el-input v-model="form.config.url" placeholder="https://pan.example.com/dav/" />
          </el-form-item>
          <el-form-item :label="$t('backup.username')">
            <el-input v-model="form.config.username" />
          </el-form-item>
          <el-form-item :label="$t('backup.password')">
            <div v-if="isEditing && !isEditingWebdavPwd" class="flex flex-items-center flex-between bg-fill p-10 rounded-4 border-1 w-full h-32">
              <span class="font-mono ls-2">******</span>
              <el-button link type="primary" @click="isEditingWebdavPwd = true; form.config.password = ''">{{ $t('backup.modify') }}</el-button>
            </div>
            <el-input v-else v-model="form.config.password" type="password" show-password />
          </el-form-item>
          <el-form-item :label="$t('backup.save_dir')">
            <el-input v-model="form.config.saveDir" placeholder="/nodeauth-backup" />
          </el-form-item>
        </template>

        <!-- Google Drive 配置 -->
        <template v-if="form.type === 'gdrive'">
          <!-- 1. 授权引导/状态区域 (仅在表单中没有 Token 或 正在授权 或 授权成功但未保存时显示) -->
          <div v-if="!form.config.refreshToken" class="p-10 mb-20 text-center bg-fill rounded-8 border-1 border-dashed min-h-120 flex flex-center flex-column">
             <!-- 初始/加载状态 -->
             <template v-if="!authStatusGoogle">
               <p class="mb-15 text-secondary text-13">{{ $t('backup.gdrive_auth_tip') }}</p>
               <button 
                 type="button" 
                 class="btn-oauth-auth btn-google-auth pointer" 
                 :class="{ 'is-loading': isAuthenticatingGoogle }"
                 :disabled="isAuthenticatingGoogle"
                 @click="startGoogleAuth"
               >
                 <el-icon v-if="isAuthenticatingGoogle" class="is-loading"><Loading /></el-icon>
                 <component v-else :is="iconGoogleDrive" width="20" height="20" />
                 <span>{{ isAuthenticatingGoogle ? $t('backup.waiting_authorization') : $t('backup.auth_with_google') }}</span>
               </button>
             </template>

             <!-- 授权失败反馈 -->
             <template v-else-if="authStatusGoogle === 'error'">
                <div class="text-danger flex flex-items-center flex-column py-10">
                  <el-icon size="42"><CircleClose /></el-icon>
                  <p class="mt-15 font-bold">{{ authErrorMessageGoogle }}</p>
                  <el-button type="primary" link class="mt-10" @click="startGoogleAuth">{{ $t('backup.re_authorize') }}</el-button>
                </div>
             </template>
          </div>

          <!-- 2. 已授权标识 (仅在新增模式下授权成功后显示) -->
          <el-form-item v-if="!isEditing && authStatusGoogle === 'success'" class="animate-fade-in">
            <div class="backup-status-box is-success">
              <div class="backup-status-content">
                <el-icon class="status-icon"><CircleCheck /></el-icon>
                <span class="status-text">{{ $t('backup.authorized_success_gd') }}</span>
              </div>
              <el-button type="primary" link @click="startGoogleAuth">{{ $t('backup.re_authorize') }}</el-button>
            </div>
          </el-form-item>

          <!-- 3. 配置项区域 (有 Token 时才显示) -->
          <div v-if="form.config.refreshToken">
            <el-form-item :label="$t('backup.save_dir')">
              <el-input v-model="form.config.saveDir" :placeholder="$t('backup.save_dir_placeholder')" />
              <div class="backup-form-tip">{{ $t('backup.gdrive_folder_tip') }}</div>
            </el-form-item>

            <!-- 令牌管理 (仅在编辑模式显示，且用户通常无需操作，仅提供重新授权) -->
            <el-form-item v-if="isEditing" :label="$t('backup.gdrive_refresh_token')">
              <div class="backup-status-box">
                <div class="backup-status-content">
                  <el-icon class="status-icon" color="var(--el-text-color-secondary)"><CircleCheck /></el-icon>
                  <span class="status-text text-secondary">{{ $t('backup.gdrive_token_active') }}</span>
                </div>
                <el-button type="primary" link @click="startGoogleAuth">{{ $t('backup.re_authorize') }}</el-button>
              </div>
            </el-form-item>
          </div>
        </template>

        <!-- Microsoft OneDrive 配置 -->
        <template v-if="form.type === 'onedrive'">
          <!-- 1. 授权引导/状态区域 (仅在表单中没有 Token 或 正在授权 或 授权成功但未保存时显示) -->
          <div v-if="!form.config.refreshToken" class="p-10 mb-20 text-center bg-fill rounded-8 border-1 border-dashed min-h-120 flex flex-center flex-column">
             <!-- 初始/加载状态 -->
             <template v-if="!authStatusMicrosoft">
               <p class="mb-15 text-secondary text-13">{{ $t('backup.onedrive_auth_tip') }}</p>
               <button 
                 type="button" 
                 class="btn-oauth-auth btn-microsoft-auth pointer" 
                 :class="{ 'is-loading': isAuthenticatingMicrosoft }"
                 :disabled="isAuthenticatingMicrosoft"
                 @click="startMicrosoftAuth"
               >
                 <el-icon v-if="isAuthenticatingMicrosoft" class="is-loading"><Loading /></el-icon>
                 <component v-else :is="iconOnedrive" width="20" height="20" />
                 <span>{{ isAuthenticatingMicrosoft ? $t('backup.waiting_authorization') : $t('backup.auth_with_microsoft') }}</span>
               </button>
             </template>

             <!-- 授权失败反馈 -->
             <template v-else-if="authStatusMicrosoft === 'error'">
                <div class="text-danger flex flex-items-center flex-column py-10">
                  <el-icon size="42"><CircleClose /></el-icon>
                  <p class="mt-15 font-bold">{{ authErrorMessageMicrosoft }}</p>
                  <el-button type="primary" link class="mt-10" @click="startMicrosoftAuth">{{ $t('backup.re_authorize') }}</el-button>
                </div>
             </template>
          </div>

          <!-- 2. 已授权标识 (仅在新增模式下授权成功后显示) -->
          <el-form-item v-if="!isEditing && authStatusMicrosoft === 'success'" class="animate-fade-in">
            <div class="backup-status-box is-success">
              <div class="backup-status-content">
                <el-icon class="status-icon"><CircleCheck /></el-icon>
                <span class="status-text">{{ $t('backup.authorized_success_ms') }}</span>
              </div>
              <el-button type="primary" link @click="startMicrosoftAuth">{{ $t('backup.re_authorize') }}</el-button>
            </div>
          </el-form-item>

          <!-- 3. 配置项区域 (有 Token 时才显示) -->
          <div v-if="form.config.refreshToken">
            <el-form-item :label="$t('backup.save_dir')">
              <el-input v-model="form.config.saveDir" :placeholder="$t('backup.save_dir_placeholder')" />
              <div class="backup-form-tip">{{ $t('backup.onedrive_folder_tip') }}</div>
            </el-form-item>

            <!-- 令牌管理 (仅在编辑模式显示，且用户通常无需操作，仅提供重新授权) -->
            <el-form-item v-if="isEditing" :label="$t('backup.onedrive_refresh_token')">
              <div class="backup-status-box">
                <div class="backup-status-content">
                  <el-icon class="status-icon" color="var(--el-text-color-secondary)"><CircleCheck /></el-icon>
                  <span class="status-text text-secondary">{{ $t('backup.onedrive_token_active') }}</span>
                </div>
                <el-button type="primary" link @click="startMicrosoftAuth">{{ $t('backup.re_authorize') }}</el-button>
              </div>
            </el-form-item>
          </div>
        </template>
        <!-- Baidu Netdisk 配置 -->
        <template v-if="form.type === 'baidu'">
            <!-- 1. 授权引导/状态区域 -->
            <div v-if="!form.config.refreshToken" class="p-10 mb-20 text-center bg-fill rounded-8 border-1 border-dashed min-h-120 flex flex-center flex-column">
              <template v-if="!authStatusBaidu">
                <p class="mb-15 text-secondary text-13">{{ $t('backup.baidu_auth_tip') }}</p>
                <button 
                  type="button" 
                  class="btn-oauth-auth btn-baidu-auth pointer" 
                  :class="{ 'is-loading': isAuthenticatingBaidu }"
                  :disabled="isAuthenticatingBaidu"
                  @click="startBaiduAuth"
                >
                  <el-icon v-if="isAuthenticatingBaidu" class="is-loading"><Loading /></el-icon>
                  <component v-else :is="iconBaiduNetdisk" width="20" height="20" />
                  <span>{{ isAuthenticatingBaidu ? $t('backup.waiting_authorization') : $t('backup.auth_with_baidu') }}</span>
                </button>
              </template>
              <template v-else-if="authStatusBaidu === 'error'">
                  <div class="text-danger flex flex-items-center flex-column py-10">
                    <el-icon size="42"><CircleClose /></el-icon>
                    <p class="mt-15 font-bold">{{ authErrorMessageBaidu }}</p>
                    <el-button type="primary" link class="mt-10" @click="startBaiduAuth">{{ $t('backup.re_authorize') }}</el-button>
                  </div>
              </template>
            </div>

            <!-- 2. 已授权标识 -->
            <el-form-item v-if="!isEditing && authStatusBaidu === 'success'" class="animate-fade-in">
              <div class="backup-status-box is-success">
                <div class="backup-status-content">
                  <el-icon class="status-icon"><CircleCheck /></el-icon>
                  <span class="status-text">{{ $t('backup.authorized_success_baidu') }}</span>
                </div>
                <el-button type="primary" link @click="startBaiduAuth">{{ $t('backup.re_authorize') }}</el-button>
              </div>
            </el-form-item>

            <!-- 3. 配置项区域 -->
            <div v-if="form.config.refreshToken">
              <el-form-item :label="$t('backup.save_dir')">
                <el-input v-model="form.config.saveDir" :placeholder="$t('backup.save_dir_placeholder')" />
                <div class="backup-form-tip">{{ $t('backup.baidu_folder_tip') }}</div>
              </el-form-item>
              <el-form-item v-if="isEditing" :label="$t('backup.baidu_refresh_token')">
                <div class="backup-status-box">
                  <div class="backup-status-content">
                    <el-icon class="status-icon" color="var(--el-text-color-secondary)"><CircleCheck /></el-icon>
                    <span class="status-text text-secondary">{{ $t('backup.baidu_token_active') }}</span>
                  </div>
                  <el-button type="primary" link @click="startBaiduAuth">{{ $t('backup.re_authorize') }}</el-button>
                </div>
              </el-form-item>
            </div>
        </template>
        <!-- Dropbox 配置 -->
        <template v-if="form.type === 'dropbox'">
            <!-- 1. 授权引导/状态区域 -->
            <div v-if="!form.config.refreshToken" class="p-10 mb-20 text-center bg-fill rounded-8 border-1 border-dashed min-h-120 flex flex-center flex-column">
              <template v-if="!authStatusDropbox">
                <p class="mb-15 text-secondary text-13">{{ $t('backup.dropbox_auth_tip') }}</p>
                <button 
                  type="button" 
                  class="btn-oauth-auth btn-dropbox-auth pointer" 
                  :class="{ 'is-loading': isAuthenticatingDropbox }"
                  :disabled="isAuthenticatingDropbox"
                  @click="startDropboxAuth"
                >
                  <el-icon v-if="isAuthenticatingDropbox" class="is-loading"><Loading /></el-icon>
                  <component v-else :is="iconDropbox" width="20" height="20" />
                  <span>{{ isAuthenticatingDropbox ? $t('backup.waiting_authorization') : $t('backup.auth_with_dropbox') }}</span>
                </button>
              </template>
              <template v-else-if="authStatusDropbox === 'error'">
                  <div class="text-danger flex flex-items-center flex-column py-10">
                    <el-icon size="42"><CircleClose /></el-icon>
                    <p class="mt-15 font-bold">{{ authErrorMessageDropbox }}</p>
                    <el-button type="primary" link class="mt-10" @click="startDropboxAuth">{{ $t('backup.re_authorize') }}</el-button>
                  </div>
              </template>
            </div>

            <!-- 2. 已授权标识 -->
            <el-form-item v-if="!isEditing && authStatusDropbox === 'success'" class="animate-fade-in">
              <div class="backup-status-box is-success">
                <div class="backup-status-content">
                  <el-icon class="status-icon"><CircleCheck /></el-icon>
                  <span class="status-text">{{ $t('backup.authorized_success_dropbox') }}</span>
                </div>
                <el-button type="primary" link @click="startDropboxAuth">{{ $t('backup.re_authorize') }}</el-button>
              </div>
            </el-form-item>

            <!-- 3. 配置项区域 -->
            <div v-if="form.config.refreshToken">
              <el-form-item :label="$t('backup.save_dir')">
                <el-input v-model="form.config.saveDir" :placeholder="$t('backup.save_dir_placeholder')" />
                <div class="backup-form-tip">{{ $t('backup.gdrive_folder_tip') }}</div>
              </el-form-item>
              <el-form-item v-if="isEditing" :label="$t('backup.dropbox_refresh_token')">
                <div class="backup-status-box">
                  <div class="backup-status-content">
                    <el-icon class="status-icon" color="var(--el-text-color-secondary)"><CircleCheck /></el-icon>
                    <span class="status-text text-secondary">{{ $t('backup.dropbox_token_active') }}</span>
                  </div>
                  <el-button type="primary" link @click="startDropboxAuth">{{ $t('backup.re_authorize') }}</el-button>
                </div>
              </el-form-item>
            </div>
        </template>

        <!-- GitHub 配置 -->
        <template v-if="form.type === 'github'">
          <el-form-item :label="$t('backup.github_token')">
            <div v-if="isEditing && !isEditingGithubToken" class="flex flex-items-center flex-between bg-fill p-10 rounded-4 border-1 w-full h-32">
              <span class="font-mono ls-2">******</span>
              <el-button link type="primary" @click="isEditingGithubToken = true; form.config.token = ''">{{ $t('backup.modify') }}</el-button>
            </div>
            <el-input v-else v-model="form.config.token" type="password" show-password :placeholder="$t('backup.github_token_placeholder')" @input="authStatusGithub = null" />
          </el-form-item>
          <el-alert v-if="authStatusGithub === 'error'" :title="authErrorMessageGithub" type="error" show-icon :closable="false" class="mb-15" />
          <el-form-item :label="$t('backup.github_owner')">
            <el-input v-model="form.config.owner" :placeholder="$t('backup.github_owner_placeholder')" @input="authStatusGithub = null" />
          </el-form-item>
          <el-form-item :label="$t('backup.github_repo')">
            <el-input v-model="form.config.repo" :placeholder="$t('backup.github_repo_placeholder')" @input="authStatusGithub = null" />
          </el-form-item>
          <el-form-item :label="$t('backup.github_branch')">
            <el-input v-model="form.config.branch" :placeholder="$t('backup.github_branch_placeholder')" @input="authStatusGithub = null" />
          </el-form-item>
          <el-form-item :label="$t('backup.save_dir')">
            <el-input v-model="form.config.saveDir" placeholder="/nodeauth-backup" @input="authStatusGithub = null" />
          </el-form-item>
        </template>

        <!-- Email (SMTP) 配置 -->
        <template v-if="form.type === 'email'">
          <el-alert type="info" :description="$t('backup.email_tip')" :closable="false" class="mb-15" show-icon />

          <!-- SMTP 服务器 + 端口 -->
          <el-form-item :label="$t('backup.email_smtp_host')">
            <div class="flex gap-10" style="width:100%">
              <el-input
                v-model="form.config.smtpHost"
                :placeholder="$t('backup.email_smtp_host_placeholder')"
                style="flex:1"
              />
              <el-input-number
                v-model="form.config.smtpPort"
                :min="1"
                :max="65535"
                style="width: 110px"
                controls-position="right"
              />
            </div>
          </el-form-item>

          <!-- 加密方式 -->
          <el-form-item :label="$t('backup.email_smtp_secure')">
            <el-radio-group v-model="form.config.smtpSecure" @change="handleSmtpSecureChange">
              <el-radio :value="false">{{ $t('backup.email_smtp_secure_tls') }}</el-radio>
              <el-radio :value="true">{{ $t('backup.email_smtp_secure_ssl') }}</el-radio>
            </el-radio-group>
          </el-form-item>

          <!-- 发件人账号 -->
          <el-form-item :label="$t('backup.email_smtp_user')">
            <el-input v-model="form.config.smtpUser" :placeholder="$t('backup.email_smtp_user_placeholder')" />
          </el-form-item>

          <!-- 授权码 / 密码 -->
          <el-form-item :label="$t('backup.email_smtp_password')">
            <div v-if="isEditing && !isEditingEmailPwd" class="flex flex-items-center flex-between bg-fill p-10 rounded-4 border-1 w-full h-32">
              <span class="font-mono ls-2">******</span>
              <el-button link type="primary" @click="isEditingEmailPwd = true; form.config.smtpPassword = ''">{{ $t('backup.modify') }}</el-button>
            </div>
            <el-input v-else v-model="form.config.smtpPassword" type="password" show-password />
          </el-form-item>

          <!-- 发件人昵称（可选） -->
          <el-form-item :label="$t('backup.email_smtp_from')">
            <el-input v-model="form.config.smtpFrom" :placeholder="$t('backup.email_smtp_from_placeholder')" />
          </el-form-item>

          <!-- 收件人邮箱 -->
          <el-form-item :label="$t('backup.email_smtp_to')">
            <el-input v-model="form.config.smtpTo" :placeholder="$t('backup.email_smtp_to_placeholder')" />
          </el-form-item>
        </template>

        <el-divider content-position="left">{{ $t('backup.auto_backup_config') }}</el-divider>
        <el-form-item :label="$t('backup.auto_backup')">
          <el-switch v-model="form.autoBackup" :active-text="$t('backup.switch_on')" :inactive-text="$t('backup.switch_off')" />
        </el-form-item>
        <template v-if="form.autoBackup">
          <el-form-item :label="$t('backup.encrypt_password')">
            <template v-if="isEditing && isAutoBackupPasswordSaved">
                <el-radio-group v-model="shouldUseExistingAutoBackupPassword" class="mb-10">
                  <el-radio :label="true">{{ $t('backup.keep_old_pwd') }}</el-radio>
                  <el-radio :label="false">{{ $t('backup.set_new_pwd') }}</el-radio>
                </el-radio-group>
                <div v-if="shouldUseExistingAutoBackupPassword" class="backup-status-box is-success mb-10">
                  <div class="backup-status-content">
                    <el-icon class="status-icon"><CircleCheck /></el-icon>
                    <span class="status-text">{{ $t('backup.continue_use_old_pwd') }}</span>
                  </div>
                </div>
            </template>
            
            <div v-if="!isEditing || !isAutoBackupPasswordSaved || !shouldUseExistingAutoBackupPassword" class="w-full">
              <el-input v-model="form.autoBackupPassword" type="password" show-password :placeholder="$t('backup.input_encrypt_pwd')" />
              <div class="backup-form-tip"><span class="text-danger">*</span> {{ $t('backup.password_length_req') }}</div>
            </div>
          </el-form-item>
        </template>
        <el-form-item :label="$t('backup.retain_count_label')" v-if="form.autoBackup">
          <el-input-number v-model="form.autoBackupRetain" :min="0" :max="999" :label="$t('backup.retain_count_label')"></el-input-number>
          <div class="backup-form-tip w-full">{{ $t('backup.retain_zero_tip') }}</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="() => testConnection()" :loading="isTesting">{{ $t('backup.test_connection') }}</el-button>
        <el-button type="primary" @click="saveProvider" :loading="isSaving">{{ $t('backup.save') }}</el-button>
      </template>
    </ResponsiveOverlay>

    <!-- 备份弹窗 -->
    <ResponsiveOverlay v-model="showBackupDialog" :title="$t('backup.encrypted_backup')" width="400px">



      <el-alert :title="$t('common.data_security')" type="info" :description="$t('backup.backup_security_tip')" show-icon :closable="false" class="mb-20" />
      
      <div v-if="currentActionProvider?.auto_backup" style="margin-bottom: 15px;">
        <el-radio-group v-model="useAutoPassword">
          <el-radio :value="true">{{ $t('backup.use_auto_pwd') }}</el-radio>
          <el-radio :value="false">{{ $t('backup.use_new_pwd') }}</el-radio>
        </el-radio-group>
      </div>

      <el-input v-if="!currentActionProvider?.auto_backup || !useAutoPassword" v-model="backupPassword" type="password" show-password :placeholder="$t('backup.input_custom_pwd')" />

      <template #footer>
        <el-button @click="showBackupDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleBackup" :loading="isBackingUp">{{ $t('backup.start_backup') }}</el-button>
      </template>
    </ResponsiveOverlay>

    <!-- 恢复列表弹窗 -->
    <ResponsiveOverlay v-model="showRestoreListDialog" :title="$t('backup.select_restore_file')" width="600px">


      <!-- Email 备份专用提示：该类型无法在线下载，引导用户从邮箱手动导入 -->
      <el-alert
        v-if="currentActionProvider?.type === 'email'"
        :title="$t('backup.email_download_not_supported')"
        type="warning"
        show-icon
        :closable="false"
        class="mb-15"
      />
      <el-table :data="backupFiles" v-loading="isLoadingFiles" height="300px" style="width: 100%">
        <el-table-column prop="filename" :label="$t('backup.filename')" show-overflow-tooltip />
        <el-table-column :label="$t('backup.size')" width="100">
          <template #default="scope">
            {{ formatSize(scope.row.size) }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('backup.time')" width="180">
          <template #default="scope">
            {{ formatDate(scope.row.lastModified) }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('backup.action')" width="100">
          <template #default="scope">
            <el-button link type="primary" @click="selectRestoreFile(scope.row)">{{ $t('backup.restore') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </ResponsiveOverlay>

    <!-- 恢复确认弹窗 -->
    <ResponsiveOverlay v-model="showRestoreConfirmDialog" :title="$t('backup.decrypt_restore')" width="400px">


      <el-alert :title="$t('common.warning')" type="warning" :description="$t('backup.restore_warning')" show-icon :closable="false" class="mb-15" />
      <el-input v-model="restorePassword" type="password" show-password :placeholder="$t('backup.input_restore_pwd')" />
      <template #footer>
        <el-button @click="showRestoreConfirmDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" @click="handleRestore" :loading="isRestoring">{{ $t('backup.confirm_restore') }}</el-button>
      </template>
    </ResponsiveOverlay>

  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { Plus, Edit, Delete, CircleCheck, CircleClose, Timer, Loading } from '@element-plus/icons-vue'
import iconGoogleDrive from '@/shared/components/icons/iconGoogleDrive.vue'
import iconOnedrive from '@/shared/components/icons/iconOnedrive.vue'
import iconBaiduNetdisk from '@/shared/components/icons/iconBaiduNetdisk.vue'
import iconDropbox from '@/shared/components/icons/iconDropbox.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useBackupProviders } from '@/features/backup/composables/useBackupProviders'
import { useBackupActions } from '@/features/backup/composables/useBackupActions'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'



const emit = defineEmits(['restore-success'])
const layoutStore = useLayoutStore()

const {
  providers, isLoading, showConfigDialog, isEditing, isTesting, isSaving,
  testingProviderIds, testResults,
  isEditingWebdavPwd, isEditingS3Secret, isEditingTelegramToken, isEditingEmailPwd, isEditingGithubToken, form,
  isAutoBackupPasswordSaved, shouldUseExistingAutoBackupPassword, fetchProviders, openAddDialog,
  editProvider, testConnection, saveProvider, deleteProvider,
  startGoogleAuth, startMicrosoftAuth, startBaiduAuth, startDropboxAuth, handleAuthMessage,
  isAuthenticatingGoogle, isAuthenticatingMicrosoft, isAuthenticatingBaidu, isAuthenticatingDropbox,
  authStatusGoogle, authStatusMicrosoft, authStatusBaidu, authStatusDropbox, authStatusGithub,
  authErrorMessageGoogle, authErrorMessageMicrosoft, authErrorMessageBaidu, authErrorMessageDropbox, authErrorMessageGithub,
  setupAuthListener, availableTypes
} = useBackupProviders()

const {
  showBackupDialog, backupPassword, isBackingUp, checkingBackupProviderId, useAutoPassword, currentActionProvider,
  openBackupDialog, handleBackup, showRestoreListDialog, isLoadingFiles, checkingRestoreProviderId, backupFiles,
  showRestoreConfirmDialog, restorePassword, selectedFile, isRestoring, openRestoreDialog,
  selectRestoreFile, handleRestore
} = useBackupActions(emit, fetchProviders, (provider) => editProvider(provider))

let cleanupAuthListener = null

onMounted(() => {
  cleanupAuthListener = setupAuthListener((e) => {
    const data = e instanceof MessageEvent ? e.data : e
    console.log('[BackupSettings] Received auth signal:', data?.type)
  })
})

onUnmounted(() => {
  if (cleanupAuthListener) cleanupAuthListener()
})

const handleSmtpSecureChange = (val) => {
  if (val) {
    // SSL/TLS -> 465
    if (!form.value.config.smtpPort || form.value.config.smtpPort === 587) {
      form.value.config.smtpPort = 465
    }
  } else {
    // STARTTLS -> 587
    if (!form.value.config.smtpPort || form.value.config.smtpPort === 465) {
      form.value.config.smtpPort = 587
    }
  }
}


const getProviderTypeTag = (type) => {
  const map = {
    webdav: 'danger',
    s3: 'warning',
    telegram: 'primary',
    gdrive: 'success',
    onedrive: 'primary',
    baidu: 'primary',
    dropbox: 'primary',
    email: 'success',
    github: 'warning'
  }
  return map[type] || 'info'
}

const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}
</script>