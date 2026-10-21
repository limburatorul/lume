# Draws the icons Explorer shows for a list of shell paths: files, shortcuts
# whose icon lives in a DLL, shortcuts with no file target (Control Panel, Run)
# and shell:AppsFolder\<AppID> for Store apps. Reads one path per line from the
# file named by -List and prints "LUME:<line>:<base64 png>" for each it drew.
param([string]$List, [int]$Size = 96)
$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class LumeShellIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }

  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public short bmPlanes; public short bmBitsPixel; public IntPtr bmBits; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount; public int biCompression; public int biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter; public int biClrUsed; public int biClrImportant; }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItemImageFactory item);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, ref BITMAP bm);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, int start, int lines, byte[] bits, ref BITMAPINFOHEADER bi, int usage);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

  public static string Png(string path, int size) {
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out factory);
    SIZE s; s.cx = size; s.cy = size;
    IntPtr hbm;
    // SIIGBF_BIGGERSIZEOK | SIIGBF_ICONONLY: the icon, never a preview of the file's content.
    if (factory.GetImage(s, 0x1 | 0x4, out hbm) != 0) return null;
    try {
      BITMAP bm = new BITMAP();
      GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref bm);
      int w = bm.bmWidth, h = bm.bmHeight;
      BITMAPINFOHEADER bi = new BITMAPINFOHEADER();
      bi.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
      bi.biWidth = w;
      bi.biHeight = -h;
      bi.biPlanes = 1;
      bi.biBitCount = 32;
      byte[] px = new byte[w * h * 4];
      IntPtr dc = GetDC(IntPtr.Zero);
      try { if (GetDIBits(dc, hbm, 0, h, px, ref bi, 0) == 0) return null; } finally { ReleaseDC(IntPtr.Zero, dc); }
      // The shell hands back premultiplied alpha, or no alpha at all for old icons.
      bool hasAlpha = false;
      for (int i = 3; i < px.Length; i += 4) if (px[i] != 0) { hasAlpha = true; break; }
      for (int i = 0; i < px.Length; i += 4) {
        int a = hasAlpha ? px[i + 3] : 255;
        if (a > 0 && a < 255) for (int c = 0; c < 3; c++) px[i + c] = (byte)Math.Min(255, px[i + c] * 255 / a);
        px[i + 3] = (byte)a;
      }
      using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
        using (MemoryStream ms = new MemoryStream()) {
          bmp.Save(ms, ImageFormat.Png);
          return Convert.ToBase64String(ms.ToArray());
        }
      }
    } finally {
      DeleteObject(hbm);
    }
  }
}
'@

$n = 0
foreach ($p in [IO.File]::ReadAllLines($List, [Text.Encoding]::UTF8)) {
  try {
    $png = [LumeShellIcon]::Png($p, $Size)
    if ($png) { [Console]::Out.WriteLine('LUME:' + $n + ':' + $png) }
  } catch {
    # A path the shell cannot parse just keeps its glyph.
  }
  $n++
}
