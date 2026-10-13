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
  # -InputObject: piped, a one-entry list would be written as a bare object
  [System.IO.File]::WriteAllText((Join-Path $io $file), (ConvertTo-Json -InputObject $object -Depth 8), $utf8)
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
# SmartScreen for downloaded programs: the shell's setting and the policy (absent = Windows default)
$smartScreen = [ordered]@{ explorer = $null; policy = $null }
try { $smartScreen.explorer = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -ErrorAction Stop).SmartScreenEnabled } catch { }
try { $smartScreen.policy = (Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -ErrorAction Stop).EnableSmartScreen } catch { }
$facts = [ordered]@{
  mode = $Mode; os = $os.Caption; version = $os.Version; build = $os.BuildNumber; edition = $cv.EditionID
  displayVersion = $cv.DisplayVersion; user = $env:USERNAME; culture = (Get-Culture).Name
  uiCulture = (Get-UICulture).Name; memoryGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  smartAppControl = $sac; smartScreen = $smartScreen; vcRuntimeInSystem32 = $vc; vcRedistributables = $redist
  network = [ordered]@{ ping = $online; dns = $dns }
}
Save-Json $facts "facts.json"
Write-Host ("facts: " + ($facts | ConvertTo-Json -Depth 4 -Compress))

# ----- UI Automation and screenshots -------------------------------------------------------------
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NzWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] static extern IntPtr Send(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)] static extern IntPtr SendText(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", EntryPoint = "PostMessageW")] static extern bool Post(IntPtr h, uint m, IntPtr w, IntPtr l);

  public static long Style(IntPtr h) { return GetWindowLongPtr(h, -16).ToInt64(); }
  public static long ExStyle(IntPtr h) { return GetWindowLongPtr(h, -20).ToInt64(); }
  public static IntPtr[] TopWindows(int pid) {
    var found = new List<IntPtr>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == (uint)pid && IsWindowVisible(h)) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
  public static IntPtr[] Children(IntPtr parent) {
    var found = new List<IntPtr>();
    EnumChildWindows(parent, delegate (IntPtr h, IntPtr l) { found.Add(h); return true; }, IntPtr.Zero);
    return found.ToArray();
  }
  public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, s.Capacity); return s.ToString(); }
  public static string TextOf(IntPtr h) {
    int n = Send(h, 0x000E, IntPtr.Zero, IntPtr.Zero).ToInt32();   // WM_GETTEXTLENGTH
    if (n <= 0) return "";
    var s = new StringBuilder(n + 1);
    SendText(h, 0x000D, new IntPtr(n + 1), s);   // WM_GETTEXT
    return s.ToString();
  }
  public static int Left(IntPtr h) { RECT r; return GetWindowRect(h, out r) ? r.Left : int.MinValue; }
  // what a click does in a dialog: WM_COMMAND with the control id (BN_CLICKED) to the control's parent
  public static void Command(IntPtr control) { Post(GetParent(control), 0x0111, new IntPtr(GetDlgCtrlID(control) & 0xFFFF), control); }
  public static void SetCheck(IntPtr button, bool on) { Send(button, 0x00F1, new IntPtr(on ? 1 : 0), IntPtr.Zero); }   // BM_SETCHECK
  public static bool GetCheck(IntPtr button) { return Send(button, 0x00F0, IntPtr.Zero, IntPtr.Zero).ToInt64() == 1; }   // BM_GETCHECK
  public static int ComboCount(IntPtr c) { return Send(c, 0x0146, IntPtr.Zero, IntPtr.Zero).ToInt32(); }   // CB_GETCOUNT
  public static string ComboItem(IntPtr c, int i) {
    int n = Send(c, 0x0149, new IntPtr(i), IntPtr.Zero).ToInt32();   // CB_GETLBTEXTLEN
    if (n <= 0) return "";
    var s = new StringBuilder(n + 1);
    SendText(c, 0x0148, new IntPtr(i), s);   // CB_GETLBTEXT
    return s.ToString();
  }
  public static int ComboSelected(IntPtr c) { return Send(c, 0x0147, IntPtr.Zero, IntPtr.Zero).ToInt32(); }   // CB_GETCURSEL
  public static void ComboSelect(IntPtr c, int i) {
    Send(c, 0x014E, new IntPtr(i), IntPtr.Zero);   // CB_SETCURSEL
    Post(GetParent(c), 0x0111, new IntPtr((GetDlgCtrlID(c) & 0xFFFF) | (1 << 16)), c);   // CBN_SELCHANGE, as a choice by hand
  }
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
function Installer-Pids([string]$exeName) {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and (Split-Path $_.Path -Leaf) -ieq $exeName } | ForEach-Object { $_.Id })
}

# The installer and the uninstaller are standard Win32 dialogs. UI Automation inside the sandbox
# reports their controls only as panes (measured 2026-10-13: the language list, OK and Cancel were
# ControlType.Pane), so they are found by window class and control id and driven with the messages a
# click sends. SmartScreen (a modern window) is still read with UI Automation above.
$Zero = [IntPtr]::Zero
function App-Windows([string[]]$exeNames) {
  $out = @()
  foreach ($n in $exeNames) { foreach ($id in @(Installer-Pids $n)) { $out += @([NzWin]::TopWindows($id)) } }
  $out
}
function Wait-AppWindow([string[]]$exeNames, [scriptblock]$match, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    foreach ($h in (App-Windows $exeNames)) { try { if (& $match $h) { return $h } } catch { } }
    Start-Sleep -Milliseconds 700
  } while ((Get-Date) -lt $deadline)
  return $Zero
}
function Win-Control([IntPtr]$win, [int]$id, [string]$class) {
  foreach ($c in [NzWin]::Children($win)) { if ([NzWin]::GetDlgCtrlID($c) -eq $id -and [NzWin]::ClassOf($c) -eq $class) { return $c } }
  return $Zero
}
function Win-Controls([IntPtr]$win, [string]$class) {
  @([NzWin]::Children($win) | Where-Object { [NzWin]::ClassOf($_) -eq $class -and [NzWin]::IsWindowVisible($_) })
}
function Win-Buttons([IntPtr]$win, [int[]]$kinds) {
  # Button-class controls of the given BS_ kinds (radio buttons: 4, 9; check boxes: 2, 3, 5, 6)
  @(Win-Controls $win "Button" | Where-Object { $kinds -contains ([NzWin]::Style($_) -band 0xF) })
}
function Win-Texts([IntPtr]$win) {
  $out = @([NzWin]::TextOf($win))
  foreach ($c in [NzWin]::Children($win)) { if ([NzWin]::IsWindowVisible($c)) { $t = [NzWin]::TextOf($c); if ($t) { $out += $t } } }
  $out
}
function Next-Button([IntPtr]$win) {
  # the dialog's default button (Next / Install / Finish / OK): control id 1, visible and enabled
  $b = Win-Control $win 1 "Button"
  if ($b -ne $Zero -and [NzWin]::IsWindowVisible($b) -and [NzWin]::IsWindowEnabled($b)) { return $b }
  return $Zero
}
function Page-Layout([IntPtr]$win) {
  # NSIS lays out a right-to-left language by mirroring each dialog when it builds the installer:
  # WS_EX_RTLREADING and WS_EX_RIGHT on the dialog, every control's x flipped (no WS_EX_LAYOUTRTL).
  # Both are read: the reading-order style (or a layout-RTL style) and Cancel/Back placed mirrored.
  $ex = [NzWin]::ExStyle($win)
  $at = { param($id) $c = Win-Control $win $id "Button"; if ($c -ne $Zero -and [NzWin]::IsWindowVisible($c)) { [NzWin]::Left($c) } else { $null } }
  $next = & $at 1
  $cancel = & $at 2
  $back = & $at 3
  $mirrored = $null
  if ($next -ne $null -and $cancel -ne $null) { $mirrored = $cancel -lt $next }
  elseif ($next -ne $null -and $back -ne $null) { $mirrored = $back -gt $next }
  $reading = ($ex -band 0x402000) -ne 0
  [ordered]@{ rtl = ($reading -and ($mirrored -ne $false)); exStyle = ("0x{0:X}" -f $ex); mirrored = $mirrored }
}
function Choose-Arabic([IntPtr]$dlg) {
  Shot "04-language-dialog"
  $title = [NzWin]::TextOf($dlg)
  $combo = @(Win-Controls $dlg "ComboBox")[0]
  $items = @()
  $pick = -1
  $count = [NzWin]::ComboCount($combo)
  for ($i = 0; $i -lt $count; $i++) {
    $t = [NzWin]::ComboItem($combo, $i)
    $items += $t
    if ($pick -lt 0 -and $t -match "Arabic|\p{IsArabic}") { $pick = $i }
  }
  if ($pick -ge 0) { [NzWin]::ComboSelect($combo, $pick); Start-Sleep -Milliseconds 600 }
  $chosen = ""
  if ($pick -ge 0 -and [NzWin]::ComboSelected($combo) -eq $pick) { $chosen = $items[$pick] }
  Shot "05-language-arabic"
  Check "1" "the language dialog offers Arabic; Arabic chosen" ($chosen -ne "") ("dialog '{0}', items '{1}', chosen '{2}'" -f $title, ($items -join " / "), $chosen)
  $ok = Next-Button $dlg
  if ($ok -eq $Zero) { throw "no OK button on the language dialog" }
  [NzWin]::Command($ok)
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
# the D11 item in progress: a run that stops is a failed check of that item
$stage = "1"

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
    $exeName = Split-Path $setup -Leaf
    $isSmart = { param($w) ((Texts $w) -join " ") -match "Windows protected your PC|Run anyway|More info|publisher could not be verified|Unknown publisher" }
    $isLangDlg = { param($h) ([NzWin]::ClassOf($h) -eq "#32770") -and (@(Win-Controls $h "ComboBox").Count -gt 0) }
    $tStart = Get-Date
    # started the way a double-click starts it: through Explorer, so the shell's SmartScreen check applies
    Start-Process -FilePath "explorer.exe" -ArgumentList ('"{0}"' -f $setup) | Out-Null
    $launched = $false
    $deadline = (Get-Date).AddSeconds(30)
    while (-not $launched -and (Get-Date) -lt $deadline) {
      if (@(Installer-Pids $exeName).Count -gt 0) { $launched = $true; break }
      foreach ($w in (Top-Windows)) { try { if (& $isSmart $w) { $launched = $true; break } } catch { } }
      if (-not $launched) { Start-Sleep -Milliseconds 700 }
    }
    if (-not $launched) {
      Note "1" "start" "Explorer did not start the installer within 30 s; started it directly"
      Start-Process -FilePath $setup | Out-Null
    }
    Start-Sleep -Seconds 2
    Shot "02-after-start"
    # SmartScreen, when it speaks, comes before the installer's first window: watch for both at once
    $smart = $null
    $lang = $Zero
    $deadline = (Get-Date).AddSeconds(120)
    while ($smart -eq $null -and $lang -eq $Zero -and (Get-Date) -lt $deadline) {
      foreach ($w in (Top-Windows)) { try { if (& $isSmart $w) { $smart = $w; break } } catch { } }
      if ($smart -eq $null) { $lang = Wait-AppWindow @($exeName) $isLangDlg 1 }
    }
    # Microsoft Defender scans the 333 MB installer before it runs: minutes in the sandbox, not seconds
    $tRun = Get-Date
    if ($smart -ne $null) {
      $said = ((Texts $smart) -join " | ")
      [System.IO.File]::WriteAllText((Join-Path $pages "smartscreen.txt"), $said, $utf8)
      Shot "03-smartscreen"
      $more = Find-In $smart { param($e) $e.Current.Name -match "^More info$" }
      if ($more -ne $null) { [void](Press $more); Start-Sleep -Seconds 2; Shot "03b-smartscreen-more-info" }
      $run = Find-In $smart { param($e) $e.Current.ControlType -eq $CT::Button -and $e.Current.Name -match "^(Run anyway|Run)$" }
      $ran = $false
      if ($run -ne $null) { $ran = Press $run }
      Check "1" "SmartScreen warns about the unsigned installer; More info -> Run anyway" $ran $said
      $tRun = Get-Date
      $lang = Wait-AppWindow @($exeName) $isLangDlg 300
    } else {
      Note "1" "SmartScreen" ("no SmartScreen or security prompt before the installer's first window (network {0}; SmartScreen settings {1})" -f $facts.network.ping, (ConvertTo-Json -InputObject $smartScreen -Compress))
      if ($lang -eq $Zero) { $lang = Wait-AppWindow @($exeName) $isLangDlg 240 }
    }

    # the language dialog: Arabic (a missing dialog is a failed check; the pages are still checked)
    if ($lang -eq $Zero) {
      Shot "04-no-language-dialog"
      Check "1" "the language dialog offers Arabic; Arabic chosen" $false "no language dialog appeared; the pages follow in the installer's own language"
    } else {
      Note "1" "installer start" ("its language dialog appeared {0} s after it was allowed to run" -f (Elapsed $tRun))
      Choose-Arabic $lang
    }

    # the pages, in Arabic, right to left; "Only for me" (the default)
    $stage = "2"
    $pageNo = 0
    $rtl = @()
    $layouts = @()
    $installStart = $null
    $finished = $false
    $isPage = { param($h) (Next-Button $h) -ne $Zero }
    while (-not $finished -and $pageNo -lt 12) {
      $pageNo += 1
      $win = Wait-AppWindow @($exeName) $isPage 600
      if ($win -eq $Zero) { break }
      Start-Sleep -Milliseconds 800
      # a language dialog that came late is answered here, not counted as a page
      if (& $isLangDlg $win) { Choose-Arabic $win; $pageNo -= 1; Start-Sleep -Seconds 2; continue }
      $texts = Win-Texts $win
      $layout = Page-Layout $win
      $rtl += [bool]$layout.rtl
      $layouts += ("{0}: {1} mirrored {2}" -f $pageNo, $layout.exStyle, $layout.mirrored)
      [System.IO.File]::WriteAllText((Join-Path $pages ("page-{0:d2}.txt" -f $pageNo)), ($texts -join "`r`n"), $utf8)
      Shot ("06-page-{0:d2}" -f $pageNo)
      $radios = @(Win-Buttons $win @(4, 9))
      $boxes = @(Win-Buttons $win @(2, 3, 5, 6))
      if ($radios.Count -ge 2) {
        # electron-builder's install-mode page: choose "only for me" by its label (build/installer.nsh)
        $onlyForMe = @($radios | Where-Object { $label = [NzWin]::TextOf($_); $label -eq $onlyForMeAr -or $label -match "Only for me" })
        if ($onlyForMe.Count -gt 0) { foreach ($r in $radios) { [NzWin]::SetCheck($r, ($r -eq $onlyForMe[0])) } }
        $selected = @($radios | Where-Object { [NzWin]::GetCheck($_) } | ForEach-Object { [NzWin]::TextOf($_) })
        Note "1" "install-mode page" ("choices: " + (($radios | ForEach-Object { [NzWin]::TextOf($_) }) -join " / ") + "; selected: " + ($selected -join ", "))
      }
      if ($boxes.Count -ge 1 -and $installStart -ne $null) {
        # the finish page: do not start the app from the installer (the driver starts it)
        foreach ($b in $boxes) { [NzWin]::SetCheck($b, $false) }
        Check "2" "per-user install through the Arabic pages" (Test-Path $perUserExe) ("{0} s from Install to the last page" -f (Elapsed $installStart))
        $finished = $true
      }
      if ($installStart -eq $null -and $pageNo -ge 2 -and $radios.Count -lt 2) { $installStart = Get-Date }
      $next = Next-Button $win
      if ($next -ne $Zero) { [NzWin]::Command($next) }
      # the files page: wait while its progress bar shows and Next is not enabled yet
      Start-Sleep -Seconds 2
      $deadline = (Get-Date).AddMinutes(20)
      while ((Get-Date) -lt $deadline) {
        $w2 = Wait-AppWindow @($exeName) { param($h) $true } 5
        if ($w2 -eq $Zero) { break }
        $bar = @(Win-Controls $w2 "msctls_progress32")
        if ($bar.Count -eq 0 -or (Next-Button $w2) -ne $Zero) { break }
        Start-Sleep -Seconds 3
      }
    }
    $deadline = (Get-Date).AddMinutes(2)
    while ((Installer-Pids $exeName).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    Check "1" "every installer page laid out right to left (RTL reading order, mirrored controls)" (($rtl.Count -gt 0) -and -not ($rtl -contains $false)) ("{0} pages: {1}" -f $rtl.Count, ($layouts -join "; "))
    if (-not $finished) { Check "2" "per-user install through the Arabic pages" (Test-Path $perUserExe) ("total {0} s" -f (Elapsed $tStart)) }
    $desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "$product.lnk"
    $startLnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$product.lnk"
    Check "1" "desktop and Start menu shortcuts" ((Test-Path $desktopLnk) -and (Test-Path $startLnk)) "$desktopLnk | $startLnk"
    $iconsSaved = (Save-Icon $perUserExe "app-exe") -and (Save-Icon $desktopLnk "desktop-shortcut") -and (Save-Icon $startLnk "start-shortcut")
    Note "1" "icons" "saved to icons\ for comparison with build\logo.png: $iconsSaved"
    Shot "07-desktop-after-install"
  } else {
    # ----- offline: a silent per-user install ---------------------------------------------------
    $stage = "2"
    $t = Get-Date
    $p = Start-Process -FilePath $setupSource -ArgumentList @("/S", "/currentuser") -Wait -PassThru
    Check "2" "silent per-user install, no network" (($p.ExitCode -eq 0) -and (Test-Path $perUserExe)) ("exit {0}, {1} s" -f $p.ExitCode, (Elapsed $t))
  }

  # ----- 3-7: the app (and a bag, print and seal) ------------------------------------------------
  $stage = "3"
  if (Test-Path $perUserExe) {
    $extra = @()
    if ($bag) { $extra = @("--bag", $bag) }
    Run-Driver $perUserExe "peruser" $extra
    Copy-Logs $profileDir "peruser"
  }

  # ----- 8: uninstall: the program goes, the profile (licence, sessions, logs) stays --------------
  $stage = "8"
  $entry = Uninstall-Entry "HKCU"
  $uninstaller = Join-Path $perUserDir "Uninstall $product.exe"
  if (Test-Path $uninstaller) {
    $t = Get-Date
    if ($Mode -eq "full") {
      Start-Process -FilePath $uninstaller | Out-Null
      # NSIS runs the uninstaller from a temporary copy (Un_A.exe or Au_.exe)
      $unExes = @("Un_A.exe", "Uninstall $product.exe", "Au_.exe")
      $isUnPage = { param($h) ((Next-Button $h) -ne $Zero) -or ((Win-Control $h 6 "Button") -ne $Zero) }
      $n = 0
      while ($n -lt 8) {
        $n += 1
        $w = Wait-AppWindow $unExes $isUnPage 60
        if ($w -eq $Zero) { break }
        Start-Sleep -Milliseconds 800
        [System.IO.File]::WriteAllText((Join-Path $pages ("uninstall-{0:d2}.txt" -f $n)), ((Win-Texts $w) -join "`r`n"), $utf8)
        Shot ("08-uninstall-{0:d2}" -f $n)
        # the default button (id 1), or Yes (id 6) on a question box
        $b = Next-Button $w
        if ($b -eq $Zero) { $b = Win-Control $w 6 "Button" }
        if ($b -ne $Zero) { [NzWin]::Command($b) }
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
    $stage = "9"
    $t = Get-Date
    $p = Start-Process -FilePath $setupSource -ArgumentList @("/S", "/allusers") -Wait -PassThru
    $machineDir = Join-Path $env:ProgramFiles $product
    $machineExe = Join-Path $machineDir "$product.exe"
    Check "9" "all-users install under Program Files" (($p.ExitCode -eq 0) -and (Test-Path $machineExe) -and ((Uninstall-Entry "HKLM") -ne $null)) ("exit {0}, {1} s, {2}" -f $p.ExitCode, (Elapsed $t), $machineDir)
    if (Test-Path $machineExe) {
      # this profile keeps its licence: no Activate screen; the engine runs from Program Files
      Run-Driver $machineExe "allusers" @("--expect-licensed")

      # ----- 10: a standard user whose name has Arabic letters, on the all-users install ---------
      $stage = "10"
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
  $stage = "10"
  $noVc = -not ($vc["msvcp140.dll"] -or $vc["vcruntime140.dll"])
  Note "10" "Visual C++ runtime in System32" ("msvcp140 {0}, vcruntime140 {1}; redistributables: {2}" -f $vc["msvcp140.dll"], $vc["vcruntime140.dll"], ($redist -join "; "))
  if ($noVc) { Note "10" "no VC++ runtime" "this Windows has none: the engine above ran on the app's own copy" }
  Note "10" "Windows N" ("not testable here: the sandbox runs its own Windows ({0} {1}), not an N edition" -f $cv.EditionID, $cv.DisplayVersion)
  Note "10" "network" ("ping {0}, DNS {1} (mode {2})" -f $facts.network.ping, $facts.network.dns, $Mode)
} catch {
  Check $stage "the run stopped at this item" $false ($_.Exception.Message + " @ " + $_.InvocationInfo.PositionMessage)
  Shot "zz-failure"
} finally {
  Copy-Logs $profileDir "peruser-final"
  Save-Json ([ordered]@{ mode = $Mode; startedAt = $started.ToString("o"); finishedAt = (Get-Date).ToString("o"); seconds = (Elapsed $started) }) "done.json"
  Stop-Transcript | Out-Null
  # closing Windows closes the sandbox (the host waits for done.json, then for the window to go)
  shutdown.exe /s /t 20 | Out-Null
}
