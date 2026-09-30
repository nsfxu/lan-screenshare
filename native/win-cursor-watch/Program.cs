// Reports the mouse cursor's visibility and the foreground window, for the
// screen-sharing app. Chromium's screen capture on Windows (before 11 24H2)
// keeps drawing an arrow when a game hides the cursor; window capture doesn't,
// so the app shares a fullscreen game's window instead while it hides it.
//
// Output (stdout, one line per change):
//   "<hidden|visible> <foreground HWND> <fullscreen 0|1> <monitor centre x> <y>"
// Coordinates are physical pixels. Exits when stdin closes, so it never
// outlives the app.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class Program
{
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; }

    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const int PollMs = 250;
    const uint MONITOR_DEFAULTTONEAREST = 2;
    static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

    static int Main()
    {
        // Physical pixels, so the app can match monitors to its displays.
        try { SetProcessDpiAwarenessContext(PerMonitorAwareV2); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }

        var stdinClosed = new ManualResetEvent(false);
        new Thread(() =>
        {
            try { while (Console.In.Read() != -1) { } } catch { }
            stdinClosed.Set();
        }) { IsBackground = true }.Start();

        string last = null;
        do
        {
            var info = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetCursorInfo(ref info)) continue;
            // flags == 0: hidden (ShowCursor(FALSE) / SetCursor(NULL)). CURSOR_SUPPRESSED
            // (touch/pen input) is already handled by Chromium, so it counts as visible.
            string line = (info.flags == 0 ? "hidden " : "visible ") + Describe(GetForegroundWindow());
            if (line == last) continue;
            last = line;
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        } while (!stdinClosed.WaitOne(PollMs));
        return 0;
    }

    /** "<hwnd> <fullscreen> <monitor centre x> <y>" for the foreground window. */
    static string Describe(IntPtr hwnd)
    {
        RECT window;
        var monitor = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out window) ||
            !GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref monitor))
            return "0 0 0 0";
        RECT m = monitor.rcMonitor;
        bool fullscreen = window.left <= m.left && window.top <= m.top && window.right >= m.right && window.bottom >= m.bottom;
        return hwnd.ToInt64() + " " + (fullscreen ? 1 : 0) + " " + (m.left + m.right) / 2 + " " + (m.top + m.bottom) / 2;
    }
}
