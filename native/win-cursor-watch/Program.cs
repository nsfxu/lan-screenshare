// Reports when an app (typically a game) hides the mouse cursor, for the
// screen-sharing app. Chromium's screen capture on Windows (before 11 24H2)
// keeps drawing an arrow when the cursor is hidden; window capture doesn't, so
// the app uses this to suggest sharing the game's window instead.
//
// Output (stdout, one line per change): "hidden <foreground HWND>" or "visible".
// Exits when stdin closes, so it never outlives the app.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class Program
{
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }

    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

    const int PollMs = 250;

    static int Main()
    {
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
            string line = info.flags == 0 ? "hidden " + GetForegroundWindow().ToInt64() : "visible";
            if (line == last) continue;
            last = line;
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        } while (!stdinClosed.WaitOne(PollMs));
        return 0;
    }
}
