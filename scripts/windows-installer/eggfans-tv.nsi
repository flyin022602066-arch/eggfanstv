Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!define PRODUCT_KEY "Software\EggfansTV"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\EggfansTV"

Name "Eggfans TV"
OutFile "${SETUP_OUTPUT}"
InstallDir "$EXEDIR\Eggfans TV"
InstallDirRegKey HKCU "${PRODUCT_KEY}" "InstallPath"
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SetDatablockOptimize on
ShowInstDetails show
ShowUninstDetails show
BrandingText "Eggfans TV"
VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey /LANG=2052 "ProductName" "Eggfans TV"
VIAddVersionKey /LANG=2052 "FileDescription" "Eggfans TV 完整安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" ""

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安装程序将部署 Eggfans TV、协议插件、本地剪辑和语音识别工具。$\r$\n$\r$\n您可以选择安装位置。配置、项目和素材保存在安装目录的 .local\EggfansTV 中，升级和卸载均保留这些数据。$\r$\n$\r$\n模型服务需要您在软件中填写自己的 API Key。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\EggfansTV.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 Eggfans TV"
!define MUI_UNFINISHPAGE_TEXT "Eggfans TV 已卸载。您的配置、项目和素材已保留在原安装目录的 .local\EggfansTV 中。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Var RuntimeVersion
!include "${PAYLOAD_INCLUDE}"

Function .onInit
    SetShellVarContext current
    ${IfNot} ${AtLeastWin10}
        IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "Eggfans TV 需要 Windows 10 或更新系统。"
        SetErrorLevel 64
        Abort
    ${EndIf}
    ${IfNot} ${IsNativeAMD64}
        IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "此安装程序适用于 Windows x64。"
        SetErrorLevel 65
        Abort
    ${EndIf}
FunctionEnd

Function DetectWebView2
    SetRegView 64
    ReadRegStr $RuntimeVersion HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $RuntimeVersion == ""
        ReadRegStr $RuntimeVersion HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${EndIf}
    ${If} $RuntimeVersion == ""
        ReadRegStr $RuntimeVersion HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${EndIf}
    ${If} $RuntimeVersion == "0.0.0.0"
        StrCpy $RuntimeVersion ""
    ${EndIf}
FunctionEnd

Function EnsureRuntimes
    SetRegView 64
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} $0 == 1
        IfFileExists "$WINDIR\Sysnative\vcomp140.dll" vc_ready
    ${EndIf}
    DetailPrint "正在安装 Microsoft Visual C++ x64 运行环境..."
    ClearErrors
    ExecShellWait "runas" "$INSTDIR\prerequisites\VC_redist.x64.exe" "/install /quiet /norestart" SW_SHOWNORMAL
    IfErrors vc_failed
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} $0 == 1
        IfFileExists "$WINDIR\Sysnative\vcomp140.dll" vc_ready
    ${EndIf}
    vc_failed:
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "Visual C++ 运行环境未安装成功或授权已取消，请允许安装运行环境后重试。"
    SetErrorLevel 1
    Abort
    vc_ready:
    DetailPrint "Visual C++ x64 运行环境已就绪。"

    Call DetectWebView2
    ${If} $RuntimeVersion == ""
        DetailPrint "正在安装 Microsoft WebView2 离线运行环境..."
        ClearErrors
        ExecWait '"$INSTDIR\prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0
        ${If} ${Errors}
            StrCpy $0 1
        ${EndIf}
        ${If} $0 == 3010
            SetRebootFlag true
        ${ElseIf} $0 != 0
            IfSilent +2
            MessageBox MB_OK|MB_ICONSTOP "WebView2 运行环境安装失败（$0），请重试安装。"
            SetErrorLevel $0
            Abort
        ${EndIf}
        Call DetectWebView2
        ${If} $RuntimeVersion == ""
            IfSilent +2
            MessageBox MB_OK|MB_ICONSTOP "未检测到 WebView2 运行环境，请重新安装。"
            SetErrorLevel 1
            Abort
        ${EndIf}
    ${EndIf}
    DetailPrint "WebView2 运行环境已就绪。"
    SetRegView 32
FunctionEnd

Section "Eggfans TV 完整程序（必选）" MainSection
    SectionIn RO
    SetShellVarContext current
    SetOutPath "$INSTDIR"
    !insertmacro InstallPayload
    WriteUninstaller "$INSTDIR\卸载 Eggfans TV.exe"
    Call EnsureRuntimes
    SetRegView 32
    WriteRegStr HKCU "${PRODUCT_KEY}" "InstallPath" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Eggfans TV"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Eggfans TV"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\EggfansTV.exe,0"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\卸载 Eggfans TV.exe$\"'
    WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\卸载 Eggfans TV.exe$\" /S'
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${INSTALL_SIZE_KIB}
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
    CreateDirectory "$SMPROGRAMS\Eggfans TV"
    SetOutPath "$INSTDIR"
    CreateShortcut "$SMPROGRAMS\Eggfans TV\Eggfans TV.lnk" "$INSTDIR\EggfansTV.exe" "" "$INSTDIR\EggfansTV.exe" 0
    CreateShortcut "$SMPROGRAMS\Eggfans TV\卸载 Eggfans TV.lnk" "$INSTDIR\卸载 Eggfans TV.exe"
SectionEnd

Section "桌面快捷方式" DesktopSection
    SetShellVarContext current
    SetOutPath "$INSTDIR"
    CreateShortcut "$DESKTOP\Eggfans TV.lnk" "$INSTDIR\EggfansTV.exe" "" "$INSTDIR\EggfansTV.exe" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
!insertmacro MUI_DESCRIPTION_TEXT ${MainSection} "安装所有功能板块、协议插件、本地剪辑和语音识别工具，并自动检查所需的微软运行环境。"
!insertmacro MUI_DESCRIPTION_TEXT ${DesktopSection} "在当前用户桌面创建 Eggfans TV 启动入口。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
    SetShellVarContext current
    !insertmacro UninstallPayload
    Delete "$INSTDIR\卸载 Eggfans TV.exe"
    Delete "$DESKTOP\Eggfans TV.lnk"
    Delete "$SMPROGRAMS\Eggfans TV\Eggfans TV.lnk"
    Delete "$SMPROGRAMS\Eggfans TV\卸载 Eggfans TV.lnk"
    RMDir "$SMPROGRAMS\Eggfans TV"
    SetRegView 32
    ReadRegStr $0 HKCU "${PRODUCT_KEY}" "InstallPath"
    ${If} $0 == $INSTDIR
        DeleteRegKey HKCU "${PRODUCT_KEY}"
        DeleteRegKey HKCU "${UNINSTALL_KEY}"
    ${EndIf}
    RMDir "$INSTDIR"
SectionEnd
