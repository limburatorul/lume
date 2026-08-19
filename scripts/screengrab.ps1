# Captures the whole primary screen, so DWM-composited effects (acrylic blur)
# are visible. webContents.capturePage() only sees the page, not the backdrop.
param([string]$Out = "screen.png")
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# Virtual bounds cover every monitor; the launcher opens on whichever
# one the cursor is on.
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save((Resolve-Path -LiteralPath (Split-Path $Out -Parent)).Path + '\' + (Split-Path $Out -Leaf),
          [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "captured $($b.Width)x$($b.Height)"
