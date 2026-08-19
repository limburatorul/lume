# Enumerates Store/UWP apps that appear in the Start menu, resolving each one's
# logo to a concrete PNG on disk. Emits a JSON array of {Name, AppID, Logo}.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Resolve-Logo {
    param([string]$InstallLocation, [string]$LogoRelative)
    if (-not $InstallLocation -or -not $LogoRelative) { return $null }
    $full = Join-Path $InstallLocation $LogoRelative
    if (Test-Path -LiteralPath $full) { return $full }

    # Packaged assets ship as scale/target-size variants, e.g. Square44x44Logo.scale-200.png
    $dir = Split-Path $full -Parent
    $base = [System.IO.Path]::GetFileNameWithoutExtension($full)
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $candidates = Get-ChildItem -LiteralPath $dir -Filter "$base*.png" -File
    if (-not $candidates) { return $null }
    foreach ($pattern in @('targetsize-48_altform-unplated', 'targetsize-48', 'scale-200', 'scale-100', 'targetsize-32')) {
        $hit = $candidates | Where-Object { $_.Name -like "*$pattern*" } | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return ($candidates | Sort-Object Length -Descending | Select-Object -First 1).FullName
}

$packages = @{}
foreach ($p in Get-AppxPackage) {
    if ($p.InstallLocation) { $packages[$p.PackageFamilyName] = $p.InstallLocation }
}

$out = New-Object System.Collections.ArrayList
foreach ($app in Get-StartApps) {
    # Only package-backed apps; plain Start menu shortcuts are indexed separately.
    if ($app.AppID -notmatch '^(?<pfn>[^\/!]+_[a-z0-9]{13})!') { continue }
    $pfn = $Matches['pfn']
    $loc = $packages[$pfn]
    $logo = $null
    if ($loc) {
        $manifest = Join-Path $loc 'AppxManifest.xml'
        if (Test-Path -LiteralPath $manifest) {
            try {
                [xml]$xml = Get-Content -LiteralPath $manifest -Raw
                $node = $xml.Package.Applications.Application
                if ($node -is [array]) { $node = $node[0] }
                $rel = $node.VisualElements.Square44x44Logo
                if (-not $rel) { $rel = $node.VisualElements.Logo }
                if (-not $rel) { $rel = $xml.Package.Properties.Logo }
                $logo = Resolve-Logo -InstallLocation $loc -LogoRelative $rel
            } catch { }
        }
    }
    [void]$out.Add([pscustomobject]@{ Name = $app.Name; AppID = $app.AppID; Logo = $logo })
}

$out | ConvertTo-Json -Compress -Depth 3
