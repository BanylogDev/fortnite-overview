param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("accepted", "declined")]
    [string]$Result
)

try {
    if ($Result -eq "accepted") {
        [System.Media.SystemSounds]::Asterisk.Play()
    } else {
        [System.Media.SystemSounds]::Hand.Play()
    }
} catch {
    [Console]::Beep($(if ($Result -eq "accepted") { 880 } else { 330 }), 250)
}
