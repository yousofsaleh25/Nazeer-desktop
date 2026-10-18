// The OS dialogs a packaged app opens that no test switch answers (D12: after every seal the Save
// dialog opens by itself once the viewer verified the PDF; production builds ignore
// NAZEER_E2E_SAVE_DIALOG). Win32 only, no UI Automation: the visible standard dialogs (#32770) of
// the app's processes (found by their executable's path: the pid a launcher reports need not be
// the process that owns the dialog) are sent IDCANCEL, what their Cancel button sends. Used by sandbox-app.mjs
// inside Windows Sandbox; kept ASCII-only like sandbox-run.ps1.
import { spawnSync } from "node:child_process";

// $ExePath and $TimeoutMs are set in front of it (cancelOsDialogs)
const SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NzDialogs {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "PostMessageW")] static extern bool Post(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static List<string> CancelAll(HashSet<uint> targets) {
    var titles = new List<string>();
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!targets.Contains(pid) || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256);
      GetClassNameW(h, cls, 256);
      if (cls.ToString() != "#32770") return true;
      var title = new StringBuilder(512);
      GetWindowTextW(h, title, 512);
      Post(h, 0x0111, new IntPtr(2), IntPtr.Zero);   // WM_COMMAND, IDCANCEL
      titles.Add(title.ToString());
      return true;
    }, IntPtr.Zero);
    return titles;
  }
}
"@
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
do {
  $pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
  Get-Process | Where-Object { $_.Path -eq $ExePath } | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
  $titles = [NzDialogs]::CancelAll($pids)
  if ($titles.Count -gt 0) {
    foreach ($t in $titles) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)) }
    exit 0
  }
  Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
exit 3
`;

/**
 * Wait up to `timeoutMs` for a standard dialog of a process running `exePath` and cancel every one
 * shown. Returns their titles (empty: none appeared in time).
 */
export function cancelOsDialogs(exePath, timeoutMs) {
  // -EncodedCommand (UTF-16LE, base64): a multi-line script with quotes does not reach PowerShell
  // intact through the Windows command line as -Command
  const quoted = `'${String(exePath).replace(/'/g, "''")}'`;
  const script = `$ExePath = ${quoted}\n$TimeoutMs = ${Number(timeoutMs)}\n${SCRIPT}`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
  const run = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    timeout: timeoutMs + 60_000,
    windowsHide: true,
  });
  if (run.status !== 0) return [];
  return run.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => Buffer.from(line.trim(), "base64").toString("utf8"));
}
