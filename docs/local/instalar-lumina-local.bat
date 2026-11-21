<# :
@echo off
setlocal
chcp 65001 >nul
title Instalador de Lumina Local
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create((Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8)))"
echo.
pause
exit /b
#>

# ============================================================================
#  Lumina Local - instalador para Windows
#  Instala stable-diffusion.cpp (Vulkan: AMD, NVIDIA e Intel) y el modelo
#  Z-Image-Turbo para generar imagenes con tu propia GPU, gratis y sin limites.
#  Todo se instala en %LOCALAPPDATA%\LuminaLocal (no necesita administrador).
#  Codigo: https://github.com/Yasser-1701/lumina-studio
# ============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppUrl   = 'https://yasser-1701.github.io/lumina-studio/?local=1'
$IconUrl  = 'https://yasser-1701.github.io/lumina-studio/icons/lumina.ico'
$Root     = Join-Path $env:LOCALAPPDATA 'LuminaLocal'
$Bin      = Join-Path $Root 'bin'
$Models   = Join-Path $Root 'models'
$NeedGB   = 9

$ModelFiles = @(
  @{ Name = 'Modelo Z-Image-Turbo (3,9 GB)';          Path = 'diffusion_models\z_image_turbo-Q4_K.gguf';
     Url  = 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf' },
  @{ Name = 'Codificador de texto Qwen3-4B (2,5 GB)'; Path = 'text_encoders\Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
     Url  = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf' },
  @{ Name = 'VAE (0,3 GB)';                            Path = 'vae\ae.safetensors';
     Url  = 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors' }
)

function Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

$HasCurl = [bool](Get-Command curl.exe -ErrorAction SilentlyContinue)

# Descarga con reanudacion: si se corta, al volver a ejecutar continua donde iba.
function Get-File([string]$Url, [string]$Dest) {
  $dir = Split-Path -Parent $Dest
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $done = "$Dest.ok"
  if ((Test-Path -LiteralPath $Dest) -and (Test-Path -LiteralPath $done)) {
    Write-Host '   Ya estaba descargado.' -ForegroundColor Green
    return
  }
  Remove-Item -LiteralPath $done -ErrorAction SilentlyContinue
  if (-not $HasCurl) {
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
    Set-Content -LiteralPath $done -Value 'ok'
    return
  }
  for ($i = 1; $i -le 5; $i++) {
    & curl.exe -L --fail --retry 3 --retry-delay 5 -C - -o $Dest $Url
    $code = $LASTEXITCODE
    if ($code -eq 0) {
      Set-Content -LiteralPath $done -Value 'ok'
      return
    }
    Write-Host "   La descarga fallo (codigo $code). Reintento $i de 5..." -ForegroundColor Yellow
    if ($code -eq 22 -or $code -eq 33) {
      # El servidor no acepta continuar el archivo parcial: empezamos de cero
      Remove-Item -LiteralPath $Dest -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 5
  }
  throw "No se pudo descargar: $Url"
}

function Get-SdRelease {
  $headers = @{ 'User-Agent' = 'LuminaLocal'; 'Accept' = 'application/vnd.github+json' }
  $pattern = '-bin-win-vulkan-x64\.zip$'
  try {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest' -Headers $headers
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if ($asset) { return @{ Tag = $rel.tag_name; Asset = $asset } }
  } catch {}
  $list = Invoke-RestMethod -Uri 'https://api.github.com/repos/leejet/stable-diffusion.cpp/releases?per_page=15' -Headers $headers
  foreach ($r in $list) {
    $asset = $r.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if ($asset) { return @{ Tag = $r.tag_name; Asset = $asset } }
  }
  throw 'No encontre la version de stable-diffusion.cpp para Windows con Vulkan.'
}

try {
  Write-Host ''
  Write-Host '  ======================================================' -ForegroundColor Magenta
  Write-Host '     LUMINA LOCAL  -  Imagenes con IA en tu propia GPU' -ForegroundColor Magenta
  Write-Host '  ======================================================' -ForegroundColor Magenta
  Write-Host "  Carpeta de instalacion: $Root"

  # --- 1. Comprobaciones ----------------------------------------------------
  Step 'Comprobando tu ordenador...'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Lumina Local necesita Windows de 64 bits.' }
  New-Item -ItemType Directory -Force -Path $Root, $Bin, $Models | Out-Null
  $drive = Get-PSDrive -Name $Root.Substring(0, 1)
  $freeGB = [math]::Round($drive.Free / 1GB, 1)
  Write-Host "   Espacio libre en el disco $($drive.Name): $freeGB GB"
  $pending = $ModelFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Models ($_.Path + '.ok'))) }
  if ($pending -and $freeGB -lt $NeedGB) {
    throw "Necesitas al menos $NeedGB GB libres en el disco $($drive.Name): (tienes $freeGB GB)."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\vulkan-1.dll'))) {
    Write-Host '   AVISO: no encuentro Vulkan. Actualiza los drivers de tu tarjeta grafica' -ForegroundColor Yellow
    Write-Host '   (AMD Software: Adrenalin Edition, o el driver de NVIDIA/Intel) y vuelve a intentarlo.' -ForegroundColor Yellow
  } else {
    Write-Host '   Vulkan encontrado.' -ForegroundColor Green
  }
  $gpus = (Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', '
  if ($gpus) { Write-Host "   Grafica: $gpus" }

  # --- 2. Motor (stable-diffusion.cpp con Vulkan) ----------------------------
  Step 'Descargando el motor de IA (stable-diffusion.cpp, Vulkan)...'
  $sd = Get-SdRelease
  $verFile = Join-Path $Bin 'version.txt'
  $current = if (Test-Path -LiteralPath $verFile) { (Get-Content -LiteralPath $verFile -Raw).Trim() } else { '' }
  $server = Get-ChildItem -Path $Bin -Recurse -Filter 'sd-server.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($current -eq $sd.Tag -and $server) {
    Write-Host "   Ya tienes la ultima version ($($sd.Tag))." -ForegroundColor Green
  } else {
    Write-Host "   Version $($sd.Tag): $($sd.Asset.name)"
    $zip = Join-Path $env:TEMP $sd.Asset.name
    Get-File $sd.Asset.browser_download_url $zip
    Get-ChildItem -Path $Bin -Force | Remove-Item -Recurse -Force
    Expand-Archive -LiteralPath $zip -DestinationPath $Bin -Force
    Remove-Item -LiteralPath $zip, "$zip.ok" -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $verFile -Value $sd.Tag
    $server = Get-ChildItem -Path $Bin -Recurse -Filter 'sd-server.exe' | Select-Object -First 1
  }
  if (-not $server) { throw 'La descarga no incluye sd-server.exe. Avisa en GitHub (Issues) para que lo revisemos.' }

  # --- 3. Modelos ------------------------------------------------------------
  foreach ($f in $ModelFiles) {
    Step "Descargando $($f.Name)..."
    Get-File $f.Url (Join-Path $Models $f.Path)
  }

  # --- 4. Lanzador ----------------------------------------------------------
  Step 'Creando el lanzador y los accesos directos...'
  $serverRel = $server.FullName.Substring($Root.Length).TrimStart('\')
  $launcher = Join-Path $Root 'Lumina Local.bat'
  $launcherText = @"
@echo off
title Lumina Local - tu GPU (no cierres esta ventana)
cd /d "%~dp0"
echo.
echo   LUMINA LOCAL esta arrancando en tu GPU...
echo   No cierres esta ventana mientras uses la app.
echo   La primera imagen tarda mas: el modelo se carga en la memoria.
echo.
start "" "$AppUrl"
"$serverRel" --listen-ip 127.0.0.1 --listen-port 1234 --diffusion-model "models\diffusion_models\z_image_turbo-Q4_K.gguf" --llm "models\text_encoders\Qwen3-4B-Instruct-2507-Q4_K_M.gguf" --vae "models\vae\ae.safetensors" --offload-to-cpu
echo.
echo   El servidor de Lumina Local se ha cerrado.
pause
"@
  Set-Content -LiteralPath $launcher -Value $launcherText -Encoding ASCII

  $deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lumina Local.lnk'
  $menuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Lumina Local.lnk'
  $uninstaller = Join-Path $Root 'Desinstalar Lumina Local.bat'
  $uninstallText = @"
@echo off
echo Se borrara Lumina Local (programa y modelos, unos 7 GB) de:
echo   %~dp0
choice /M "Continuar"
if errorlevel 2 exit /b
del "$deskLnk" 2>nul
del "$menuLnk" 2>nul
echo Lumina Local se ha desinstalado.
pause
cd /d "%TEMP%"
(goto) 2>nul & rd /s /q "%~dp0"
"@
  Set-Content -LiteralPath $uninstaller -Value $uninstallText -Encoding ASCII

  $icon = Join-Path $Root 'lumina.ico'
  try { Invoke-WebRequest -Uri $IconUrl -OutFile $icon -UseBasicParsing } catch { $icon = $null }

  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    if (-not $folder) { continue }
    $lnk = $shell.CreateShortcut((Join-Path $folder 'Lumina Local.lnk'))
    $lnk.TargetPath = $launcher
    $lnk.WorkingDirectory = $Root
    $lnk.Description = 'Lumina Studio con tu propia GPU'
    if ($icon) { $lnk.IconLocation = $icon }
    $lnk.Save()
  }

  Write-Host ''
  Write-Host '  ======================================================' -ForegroundColor Green
  Write-Host '   LISTO. Lumina Local esta instalado.' -ForegroundColor Green
  Write-Host '   Usa el icono "Lumina Local" de tu escritorio cada vez' -ForegroundColor Green
  Write-Host '   que quieras generar con tu GPU.' -ForegroundColor Green
  Write-Host '  ======================================================' -ForegroundColor Green
  Write-Host ''
  Write-Host '  Arrancando Lumina Local ahora...'
  Start-Process -FilePath $launcher -WorkingDirectory $Root
}
catch {
  Write-Host ''
  Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Si se corto una descarga, vuelve a abrir el instalador: continuara donde lo dejo.' -ForegroundColor Yellow
}
