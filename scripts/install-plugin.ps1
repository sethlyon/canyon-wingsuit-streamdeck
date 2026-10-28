# Installs / links the Canyon Wingsuit 3D plugin into the Elgato Stream Deck Plugins directory on Windows
$ErrorActionPreference = "Stop"

$pluginDirName = "com.slyon.canyon-wingsuit.sdPlugin"
$sourcePath = Join-Path $PSScriptRoot "..\$pluginDirName" | Resolve-Path
$streamDeckPluginsDir = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins"

if (-not (Test-Path $streamDeckPluginsDir)) {
    New-Item -ItemType Directory -Path $streamDeckPluginsDir -Force | Out-Null
}

$targetPath = Join-Path $streamDeckPluginsDir $pluginDirName

if (Test-Path $targetPath) {
    Write-Host "Removing existing plugin folder at $targetPath..."
    Remove-Item -Path $targetPath -Recurse -Force
}

Write-Host "Copying $pluginDirName to $targetPath..."
Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
Write-Host "Successfully installed Canyon Wingsuit 3D to Stream Deck Plugins folder!"
Write-Host "Restart the Elgato Stream Deck app to see 'Canyon Wingsuit 3D' in the right-hand actions sidebar."
