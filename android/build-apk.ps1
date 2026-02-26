# Build APK debug - definit JAVA_HOME avec le JDK d'Android Studio
$jbr = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path "$jbr\bin\java.exe")) {
    Write-Host "ERREUR: JDK introuvable dans $jbr" -ForegroundColor Red
    Write-Host "Installez Android Studio ou definissez JAVA_HOME vers un JDK 17." -ForegroundColor Yellow
    exit 1
}
$env:JAVA_HOME = $jbr
& "$PSScriptRoot\gradlew.bat" assembleDebug @args
