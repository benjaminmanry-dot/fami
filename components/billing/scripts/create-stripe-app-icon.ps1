Add-Type -AssemblyName System.Drawing

$output = Join-Path $PSScriptRoot '..\stripe-app\brand_icon.png'
$bitmap = [System.Drawing.Bitmap]::new(300, 300)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$navy = [System.Drawing.Color]::FromArgb(255, 12, 31, 51)
$gold = [System.Drawing.Color]::FromArgb(255, 229, 184, 82)
$crimson = [System.Drawing.Color]::FromArgb(255, 124, 34, 48)
$graphics.Clear($navy)

$goldPen = [System.Drawing.Pen]::new($gold, 12)
$crimsonPen = [System.Drawing.Pen]::new($crimson, 5)
$graphics.DrawEllipse($goldPen, 34, 34, 232, 232)
$graphics.DrawEllipse($crimsonPen, 52, 52, 196, 196)

$font = [System.Drawing.Font]::new('Georgia', 92, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.SolidBrush]::new($gold)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('20', $font, $brush, [System.Drawing.RectangleF]::new(0, 0, 300, 285), $format)

$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

$format.Dispose()
$brush.Dispose()
$font.Dispose()
$crimsonPen.Dispose()
$goldPen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
