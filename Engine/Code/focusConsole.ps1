$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ConsoleWindowControl
{
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr windowHandle, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr windowHandle);
}
"@

$windowHandle = [ConsoleWindowControl]::GetConsoleWindow()
if ($windowHandle -ne [IntPtr]::Zero) {
    [ConsoleWindowControl]::ShowWindow($windowHandle, 9) | Out-Null
    [ConsoleWindowControl]::SetForegroundWindow($windowHandle) | Out-Null
}
