; Lume installs for every user in Program Files\ProtagonistLabs\Lume and keeps
; its data in %APPDATA%\ProtagonistLabs\Lume (vault: Ecosistem-v3-foldere.md).
; An old per-user copy is replaced by electron-builder itself: it runs that
; copy's uninstaller with --updated, which removes the program and its
; shortcuts and never the data (deleteAppDataOnUninstall was never set).

; A first per-machine install goes to the studio's folder; a later one stays
; where the registry says. A /D= naming the old per-user folder (what an
; updater from before the move passes) is ignored the same way.
!macro customInit
  Var /GLOBAL fromOldUpdater
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${StdUtils.GetParameter} $2 "D" ""
  StrCpy $fromOldUpdater 0
  ${If} $0 == ""
    ${If} $2 != ""
    ${AndIf} $2 == $1
      StrCpy $fromOldUpdater 1
    ${EndIf}
    ${If} $2 == ""
    ${OrIf} $fromOldUpdater == 1
      StrCpy $INSTDIR "$PROGRAMFILES64\ProtagonistLabs\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}
!macroend

; Once, by rename (same drive, instant). A new folder that already has data is
; never mixed into, and a locked file leaves the move to the app's next start.
!macro moveDataFolder FROM TO
  RMDir "${TO}"
  ${IfNot} ${FileExists} "${TO}\*.*"
  ${AndIf} ${FileExists} "${FROM}\*.*"
    ClearErrors
    Rename "${FROM}" "${TO}"
    ${If} ${Errors}
      DetailPrint "Could not move ${FROM}; the app moves it at its next start."
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; The installer runs elevated as the user who installs; the data is that user's.
  SetShellVarContext current
  CreateDirectory "$APPDATA\ProtagonistLabs"
  !insertmacro moveDataFolder "$APPDATA\Lume" "$APPDATA\ProtagonistLabs\${APP_FILENAME}"
  SetShellVarContext all
  ; The old updater restarts the copy it knew, which is gone now: start this one.
  ${If} $fromOldUpdater == 1
  ${AndIf} ${Silent}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  ${EndIf}
!macroend
