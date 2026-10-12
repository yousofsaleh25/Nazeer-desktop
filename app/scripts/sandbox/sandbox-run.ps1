# Runs INSIDE Windows Sandbox at logon (the LogonCommand that scripts/sandbox-check.mjs writes): the
# D11 clean-PC checklist on a clean copy of Windows, unattended. Results go to C:\nz\io (mapped to
# the host): results.json (one entry per check, by D11 item), facts.json, shots\, pages\, icons\,
# logs\, run.log, and done.json last. ASCII only (Windows PowerShell 5.1 reads a file without a BOM
# as ANSI): Arabic text is built from code points.
#
# Mode "full" (network on): the installer the way a customer gets it (Mark of the Web, SmartScreen,
# the language dialog, the Arabic pages, a per-user install, icons), the app checks (Activate, keys,
# About, a bag, print and seal, close, relaunch), the GUI uninstall, an all-users install, and a
# standard Windows user with an Arabic name running the all-users install from Program Files.
# Mode "offline" (network off): a silent per-user install, the app checks, a silent uninstall.
param(
  [ValidateSet("full", "offline")][string]$Mode = "full",
  [Parameter(Mandatory = $true)][string]$InstallerName,
  [string]$BagName = ""
)

$ErrorActionPreference = "Stop"
$io = "C:\nz\io"
$shots = Join-Path $io "shots"
$pages = Join-Path $io "pages"
$icons = Join-Path $io "icons"
$logs = Join-Path $io "logs"
foreach ($d in @($shots, $pages, $icons, $logs)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
Start-Transcript -Path (Join-Path $io "run.log") -Append | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding $false
$results = New-Object System.Collections.ArrayList
$product = "Nazeer Desktop"
$started = Get-Date

function Save-Json($object, [string]$file) {
  [System.IO.File]::WriteAllText((Join-Path $io $file), ($object | ConvertTo-Json -Depth 8), $utf8)
}
function Check([string]$item, [string]$name, [bool]$ok, [string]$detail = "") {
  [void]$results.Add([ordered]@{ item = $item; name = $name; ok = $ok; detail = $detail })
  $word = "FAIL"
  if ($ok) { $word = "PASS" }
  Write-Host ("{0}  [{1}] {2}: {3}" -f $word, $item, $name, $detail)
  Save-Json $results "results.json"
}
function Note([string]$item, [string]$name, [string]$detail) {
  [void]$results.Add([ordered]@{ item = $item; name = $name; ok = $null; detail = $detail })
  Write-Host ("NOTE  [{0}] {1}: {2}" -f $item, $name, $detail)
  Save-Json $results "results.json"
}
function Elapsed($from) { [math]::Round(((Get-Date) - $from).TotalSeconds, 0) }

# ----- facts about this Windows ------------------------------------------------------------------
$os = Get-CimInstance Win32_OperatingSystem
$cv = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
$sac = $null
try { $sac = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" -ErrorAction Stop).VerifiedAndReputablePolicyState } catch { }
$vc = [ordered]@{}
foreach ($dll in @("msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll")) {
  $vc[$dll] = Test-Path (Join-Path $env:SystemRoot "System32\$dll")
}
$redist = @(Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
  Where-Object { $_.DisplayName -like "*Visual C++*" } | ForEach-Object { $_.DisplayName })
$online = $false
try { $online = [bool](Test-Connection -ComputerName 1.1.1.1 -Count 1 -Quiet -ErrorAction Stop) } catch { }
$dns = $false
try { [void][System.Net.Dns]::GetHostAddresses("www.microsoft.com"); $dns = $true } catch { }
$facts = [ordered]@{
  mode = $Mode; os = $os.Caption; version = $os.Version; build = $os.BuildNumber; edition = $cv.EditionID
  displayVersion = $cv.DisplayVersion; user = $env:USERNAME; culture = (Get-Culture).Name
  uiCulture = (Get-UICulture).Name; memoryGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  smartAppControl = $sac; vcRuntimeInSystem32 = $vc; vcRedistributables = $redist
  network = [ordered]@{ ping = $online; dns = $dns }
}
Save-Json $facts "facts.json"
Write-Host ("facts: " + ($facts | ConvertTo-Json -Depth 4 -Compress))

# ----- UI Automation and screenshots -------------------------------------------------------------
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NzWin {
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static bool IsRtl(IntPtr h) { return (GetWindowLongPtr(h, -20).ToInt64() & 0x400000) != 0; }
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$All = [System.Windows.Automation.Condition]::TrueCondition
$CT = [System.Windows.Automation.ControlType]

function Shot([string]$name) {
  try {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save((Join-Path $shots "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } catch { Write-Host "screenshot $name failed: $($_.Exception.Message)" }
}
function Top-Windows { @($AE::RootElement.FindAll($Scope::Children, $All)) }
function Descendants($el) { @($el.FindAll($Scope::Descendants, $All)) }
function Texts($el) {
  $out = @($el.Current.Name)
  foreach ($d in (Descendants $el)) { if ($d.Current.Name) { $out += $d.Current.Name } }
  $out
}
function Wait-Window([scriptblock]$match, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    foreach ($w in (Top-Windows)) {
      try { if (& $match $w) { return $w } } catch { }
    }
    Start-Sleep -Milliseconds 700
  }
  return $null
}
function Press($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return $true }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return $true }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return $true }
  return $false
}
function Find-In($root, [scriptblock]$match) {
  foreach ($d in (Descendants $root)) { if (& $match $d) { return $d } }
  return $null
}
function Button-Id($win, [string]$id) {
  Find-In $win { param($e) $e.Current.ControlType -eq $CT::Button -and $e.Current.AutomationId -eq $id -and $e.Current.IsEnabled }
}
function Window-Of-Process([int[]]$ids, [int]$seconds) {
  Wait-Window { param($w) $ids -contains $w.Current.ProcessId } $seconds
}
function Installer-Pids([string]$exeName) {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and (Split-Path $_.Path -Leaf) -ieq $exeName } | ForEach-Object { $_.Id })
}
function Save-Icon([string]$file, [string]$name) {
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($file)
    $icon.ToBitmap().Save((Join-Path $icons "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    return $true
  } catch { Write-Host "icon $name failed: $($_.Exception.Message)"; return $false }
}
function Uninstall-Entry([string]$hive) {
  Get-ChildItem "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.DisplayName -like "$product*" } | Select-Object -First 1
}
function Run-Driver([string]$exe, [string]$label, [string[]]$extra) {
  $driverArgs = @("C:\nz\scripts\sandbox-app.mjs", "--exe", $exe, "--keys", (Join-Path $io "keys.json"),
    "--out", $io, "--label", $label, "--pw", "C:\nz\pw") + $extra
  $t = Get-Date
  & "C:\nz\node\node.exe" @driverArgs 2>&1 | ForEach-Object { Write-Host $_ }
  Write-Host "driver $label finished in $(Elapsed $t) s (exit $LASTEXITCODE)"
}
function Copy-Logs([string]$profileDir, [string]$label) {
  $src = Join-Path $profileDir "logs"
  if (Test-Path $src) {
    $dst = Join-Path $logs $label
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$setupSource = Join-Path "C:\nz\installer" $InstallerName
$bag = ""
if ($BagName) {
  $bag = Join-Path "C:\nz\bags" $BagName
  if (-not (Test-Path $bag)) { Note "bag" "bag" "not mapped: $bag"; $bag = "" }
}
# "Only for me" in Arabic (build/installer.nsh onlyForMe), from its code points
$onlyForMeAr = -join ([char[]](0x0644, 0x064A, 0x0020, 0x0648, 0x062D, 0x062F, 0x064A))
$perUserDir = Join-Path $env:LOCALAPPDATA "Programs\$product"
$perUserExe = Join-Path $perUserDir "$product.exe"
$profileDir = Join-Path $env:APPDATA $product

try {
  if ($Mode -eq "full") {
    # ----- 1. the installer as a customer gets it ----------------------------------------------
    $downloads = Join-Path $env:USERPROFILE "Downloads"
    New-Item -ItemType Directory -Force -Path $downloads | Out-Null
    $setup = Join-Path $downloads $InstallerName
    Copy-Item -LiteralPath $setupSource -Destination $setup -Force
    Set-Content -LiteralPath $setup -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nHostUrl=https://example.invalid/$([uri]::EscapeDataString($InstallerName))"
    $motw = (Get-Content -LiteralPath $setup -Stream Zone.Identifier) -join " "
    Check "1" "installer copied with the Mark of the Web (as if downloaded)" ($motw -match "ZoneId=3") $motw
    [void](Save-Icon $setup "installer")
    Shot "01-downloads"
    $tStart = Get-Date
    Start-Process -FilePath $setup | Out-Null
    $smart = Wait-Window { param($w) ((Texts $w) -join " ") -match "Windows protected your PC|Run anyway|More info|publisher could not be verified" } 30
    if ($smart -ne $null) {
      $said = ((Texts $smart) -join " | ")
      [System.IO.File]::WriteAllText((Join-Path $pages "smartscreen.txt"), $said, $utf8)
      Shot "02-smartscreen"
      $more = Find-In $smart { param($e) $e.Current.Name -match "^More info$" }
      if ($more -ne $null) { [void](Press $more); Start-Sleep -Seconds 2; Shot "03-smartscreen-more-info" }
      $run = Find-In $smart { param($e) $e.Current.ControlType -eq $CT::Button -and $e.Current.Name -match "^(Run anyway|Run)$" }
      $ran = $false
      if ($run -ne $null) { $ran = Press $run }
      Check "1" "SmartScreen warns about the unsigned installer; More info -> Run anyway" $ran $said
    } else {
      Note "1" "SmartScreen" "no SmartScreen or security prompt within 30 s (network $($facts.network.ping)); the installer started directly"
    }

    # the language dialog: Arabic
    $exeName = Split-Path $setup -Leaf
    $lang = Wait-Window { param($w) ((Installer-Pids $exeName) -contains $w.Current.ProcessId) -and (Find-In $w { param($e) $e.Current.ControlType -eq $CT::ComboBox }) -ne $null } 90
    if ($lang -eq $null) { throw "the installer's language dialog did not appear" }
    Shot "04-language-dialog"
    $title = $lang.Current.Name
    $combo = Find-In $lang { param($e) $e.Current.ControlType -eq $CT::ComboBox }
    $p = $null
    if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); Start-Sleep -Milliseconds 600 }
    $arabic = Find-In $combo { param($e) $e.Current.ControlType -eq $CT::ListItem -and ($e.Current.Name -match "Arabic|[\u0600-\u06FF]") }
    if ($arabic -eq $null) { $arabic = Find-In $AE::RootElement { param($e) $e.Current.ControlType -eq $CT::ListItem -and ($e.Current.Name -match "Arabic|[\u0600-\u06FF]") } }
    $chosen = ""
    if ($arabic -ne $null) { $chosen = $arabic.Current.Name; [void](Press $arabic) }
    if ($p -ne $null) { try { $p.Collapse() } catch { } }
    Start-Sleep -Milliseconds 600
    Shot "05-language-arabic"
    Check "1" "the language dialog offers Arabic; Arabic chosen" ($chosen -ne "") "dialog '$title', item '$chosen'"
    $ok = Button-Id $lang "1"
    if ($ok -eq $null) { throw "no OK button on the language dialog" }
    [void](Press $ok)

    # the pages, in Arabic, right to left; "Only for me" (the default)
    $pageNo = 0
    $rtl = @()
    $installStart = $null
    $finished = $false
    while (-not $finished -and $pageNo -lt 12) {
      $pageNo += 1
      $win = Wait-Window { param($w) ((Installer-Pids $exeName) -contains $w.Current.ProcessId) -and (Button-Id $w "1") -ne $null } 600
      if ($win -eq $null) { break }
      Start-Sleep -Milliseconds 800
      $texts = Texts $win
      $hwnd = [IntPtr]$win.Current.NativeWindowHandle
      $isRtl = [NzWin]::IsRtl($hwnd)
      $rtl += $isRtl
      [System.IO.File]::WriteAllText((Join-Path $pages ("page-{0:d2}.txt" -f $pageNo)), ($texts -join "`r`n"), $utf8)
      Shot ("06-page-{0:d2}" -f $pageNo)
      $radios = @(Descendants $win | Where-Object { $_.Current.ControlType -eq $CT::RadioButton })
      $boxes = @(Descendants $win | Where-Object { $_.Current.ControlType -eq $CT::CheckBox })
      if ($radios.Count -ge 2) {
        # electron-builder's install-mode page: choose "only for me" by its label (build/installer.nsh)
        $onlyForMe = Find-In $win { param($e) $e.Current.ControlType -eq $CT::RadioButton -and ($e.Current.Name -eq $onlyForMeAr -or $e.Current.Name -match "Only for me") }
        if ($onlyForMe -ne $null) { [void](Press $onlyForMe) }
        $selected = @($radios | Where-Object {
            $s = $null
            $_.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$s) -and $s.Current.IsSelected
          } | ForEach-Object { $_.Current.Name })
        Note "1" "install-mode page" ("choices: " + (($radios | ForEach-Object { $_.Current.Name }) -join " / ") + "; selected: " + ($selected -join ", "))
      }
      if ($boxes.Count -ge 1 -and $installStart -ne $null) {
        # the finish page: do not start the app from the installer (the driver starts it)
        foreach ($b in $boxes) {
          $t = $null
          if ($b.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t) -and $t.Current.ToggleState -eq "On") { $t.Toggle() }
        }
        Check "2" "per-user install through the Arabic pages" (Test-Path $perUserExe) ("{0} s from Install to the last page" -f (Elapsed $installStart))
        $finished = $true
      }
      if ($installStart -eq $null -and $pageNo -ge 2 -and $radios.Count -lt 2) { $installStart = Get-Date }
      $next = Button-Id $win "1"
      if ($next -ne $null) { [void](Press $next) }
      # the files page: wait while the progress bar is there
      Start-Sleep -Seconds 2
      $deadline = (Get-Date).AddMinutes(20)
      while ((Get-Date) -lt $deadline) {
        $w2 = Window-Of-Process (Installer-Pids $exeName) 5
        if ($w2 -eq $null) { break }
        $bar = Find-In $w2 { param($e) $e.Current.ControlType -eq $CT::ProgressBar }
        if ($bar -eq $null -or (Button-Id $w2 "1") -ne $null) { break }
        Start-Sleep -Seconds 3
      }
    }
    $deadline = (Get-Date).AddMinutes(2)
    while ((Installer-Pids $exeName).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    Check "1" "every installer page laid out right to left (WS_EX_LAYOUTRTL)" (($rtl.Count -gt 0) -and -not ($rtl -contains $false)) ("{0} pages: {1}" -f $rtl.Count, ($rtl -join ","))
    if (-not $finished) { Check "2" "per-user install through the Arabic pages" (Test-Path $perUserExe) ("total {0} s" -f (Elapsed $tStart)) }
    $desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "$product.lnk"
    $startLnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$product.lnk"
    Check "1" "desktop and Start menu shortcuts" ((Test-Path $desktopLnk) -and (Test-Path $startLnk)) "$desktopLnk | $startLnk"
    $iconsSaved = (Save-Icon $perUserExe "app-exe") -and (Save-Icon $desktopLnk "desktop-shortcut") -and (Save-Icon $startLnk "start-shortcut")
    Note "1" "icons" "saved to icons\ for comparison with build\logo.png: $iconsSaved"
    Shot "07-desktop-after-install"
  } else {
    # ----- offline: a silent per-user install ---------------------------------------------------
    $t = Get-Date
    $p = Start-Process -FilePath $setupSource -ArgumentList @("/S", "/currentuser") -Wait -PassThru
    Check "2" "silent per-user install, no network" (($p.ExitCode -eq 0) -and (Test-Path $perUserExe)) ("exit {0}, {1} s" -f $p.ExitCode, (Elapsed $t))
  }

  # ----- 3-7: the app (and a bag, print and seal) ------------------------------------------------
  if (Test-Path $perUserExe) {
    $extra = @()
    if ($bag) { $extra = @("--bag", $bag) }
    Run-Driver $perUserExe "peruser" $extra
    Copy-Logs $profileDir "peruser"
  }

  # ----- 8: uninstall: the program goes, the profile (licence, sessions, logs) stays --------------
  $entry = Uninstall-Entry "HKCU"
  $uninstaller = Join-Path $perUserDir "Uninstall $product.exe"
  if (Test-Path $uninstaller) {
    $t = Get-Date
    if ($Mode -eq "full") {
      Start-Process -FilePath $uninstaller | Out-Null
      $n = 0
      while ($n -lt 8) {
        $n += 1
        $w = Wait-Window { param($w) ((Installer-Pids "Un_A.exe") + (Installer-Pids "Uninstall $product.exe") + (Installer-Pids "Au_.exe") -contains $w.Current.ProcessId) -and (Button-Id $w "1") -ne $null } 60
        if ($w -eq $null) { break }
        Start-Sleep -Milliseconds 800
        [System.IO.File]::WriteAllText((Join-Path $pages ("uninstall-{0:d2}.txt" -f $n)), ((Texts $w) -join "`r`n"), $utf8)
        Shot ("08-uninstall-{0:d2}" -f $n)
        [void](Press (Button-Id $w "1"))
        Start-Sleep -Seconds 3
      }
    } else {
      Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait | Out-Null
    }
    $deadline = (Get-Date).AddMinutes(5)
    while ((Test-Path $perUserExe) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    Start-Sleep -Seconds 3
    Check "8" "uninstall: the program and its uninstall entry are gone; the profile stays" ((-not (Test-Path $perUserExe)) -and ((Uninstall-Entry "HKCU") -eq $null) -and (Test-Path (Join-Path $profileDir "app-license.json"))) ("{0} s; entry was '{1}'" -f (Elapsed $t), $entry.DisplayName)
  }

  if ($Mode -eq "full") {
    # ----- 9: "Anyone who uses this computer" (silent: the sandbox account is an administrator) --
    $t = Get-Date
    $p = Start-Process -FilePath $setupSource -ArgumentList @("/S", "/allusers") -Wait -PassThru
    $machineDir = Join-Path $env:ProgramFiles $product
    $machineExe = Join-Path $machineDir "$product.exe"
    Check "9" "all-users install under Program Files" (($p.ExitCode -eq 0) -and (Test-Path $machineExe) -and ((Uninstall-Entry "HKLM") -ne $null)) ("exit {0}, {1} s, {2}" -f $p.ExitCode, (Elapsed $t), $machineDir)
    if (Test-Path $machineExe) {
      # this profile keeps its licence: no Activate screen; the engine runs from Program Files
      Run-Driver $machineExe "allusers" @("--expect-licensed")

      # ----- 10: a standard user whose name has Arabic letters, on the all-users install ---------
      $name = -join ([char[]](0x0645, 0x0633, 0x062A, 0x062E, 0x062F, 0x0645))
      $secret = "Nz-" + [guid]::NewGuid().ToString("N").Substring(0, 14) + "!"
      $secure = ConvertTo-SecureString $secret -AsPlainText -Force
      try {
        New-LocalUser -Name $name -Password $secure -PasswordNeverExpires -AccountNeverExpires | Out-Null
        Add-LocalGroupMember -Group "Users" -Member $name -ErrorAction SilentlyContinue
        # the standard user cannot read the mapped folders: local copies it may read and write
        $local = "C:\nzlocal"
        New-Item -ItemType Directory -Force -Path $local, "$local\out" | Out-Null
        Copy-Item "C:\nz\node\node.exe" "$local\node.exe" -Force
        Copy-Item "C:\nz\pw" "$local\pw" -Recurse -Force
        Copy-Item "C:\nz\scripts\sandbox-app.mjs" "$local\sandbox-app.mjs" -Force
        Copy-Item (Join-Path $io "keys.json") "$local\keys.json" -Force
        $userBag = ""
        if ($bag) { Copy-Item $bag "$local\bag.bag" -Force; $userBag = "$local\bag.bag" }
        & icacls $local /grant "*S-1-5-32-545:(OI)(CI)M" /T /Q | Out-Null
        $cred = New-Object System.Management.Automation.PSCredential($name, $secure)
        $driverArgs = @("$local\sandbox-app.mjs", "--exe", "`"$machineExe`"", "--keys", "$local\keys.json",
          "--out", "$local\out", "--label", "arabic-user", "--pw", "$local\pw", "--port", "9556")
        if ($userBag) { $driverArgs += @("--bag", $userBag) }
        $t = Get-Date
        $p = Start-Process -FilePath "$local\node.exe" -ArgumentList $driverArgs -Credential $cred -LoadUserProfile -WorkingDirectory $local -Wait -PassThru
        Copy-Item "$local\out\*" $io -Recurse -Force -ErrorAction SilentlyContinue
        $userProfile = Join-Path "C:\Users" $name
        Check "10" "a standard user with an Arabic name runs the all-users install" ((Test-Path (Join-Path $io "app-arabic-user.json")) -and (Test-Path (Join-Path $userProfile "AppData\Roaming\$product\app-license.json"))) ("user profile {0}; driver exit {1}, {2} s" -f $userProfile, $p.ExitCode, (Elapsed $t))
        Copy-Logs (Join-Path $userProfile "AppData\Roaming\$product") "arabic-user"
      } catch {
        Check "10" "a standard user with an Arabic name runs the all-users install" $false $_.Exception.Message
      }
      $u = Uninstall-Entry "HKLM"
      if ($u -ne $null -and (Test-Path (Join-Path $machineDir "Uninstall $product.exe"))) {
        Start-Process -FilePath (Join-Path $machineDir "Uninstall $product.exe") -ArgumentList @("/S", "/allusers") -Wait | Out-Null
        Start-Sleep -Seconds 5
        Check "9" "all-users uninstall" (-not (Test-Path $machineExe)) $machineDir
      }
    }
  }

  # ----- 10: what this Windows lacks --------------------------------------------------------------
  $noVc = -not ($vc["msvcp140.dll"] -or $vc["vcruntime140.dll"])
  Note "10" "Visual C++ runtime in System32" ("msvcp140 {0}, vcruntime140 {1}; redistributables: {2}" -f $vc["msvcp140.dll"], $vc["vcruntime140.dll"], ($redist -join "; "))
  if ($noVc) { Note "10" "no VC++ runtime" "this Windows has none: the engine above ran on the app's own copy" }
  Note "10" "Windows N" ("not testable here: the sandbox runs the host's edition ({0})" -f $cv.EditionID)
  Note "10" "network" ("ping {0}, DNS {1} (mode {2})" -f $facts.network.ping, $facts.network.dns, $Mode)
} catch {
  Check "run" "the sandbox run reached its end" $false ($_.Exception.Message + " @ " + $_.InvocationInfo.PositionMessage)
  Shot "zz-failure"
} finally {
  Copy-Logs $profileDir "peruser-final"
  Save-Json ([ordered]@{ mode = $Mode; startedAt = $started.ToString("o"); finishedAt = (Get-Date).ToString("o"); seconds = (Elapsed $started) }) "done.json"
  Stop-Transcript | Out-Null
  # closing Windows closes the sandbox (the host waits for done.json, then for the window to go)
  shutdown.exe /s /t 20 | Out-Null
}
