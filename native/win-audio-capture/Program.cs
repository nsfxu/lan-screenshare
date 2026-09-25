// win-audio-capture: system audio capture helper for ScreenShare on Windows.
//
// Default mode: WASAPI loopback of the default output device. Chromium's own
// loopback opens the device as stereo, which Windows rejects
// (AUDCLNT_E_UNSUPPORTED_FORMAT) when the output device runs in a surround mix
// format (5.1 / 7.1, common with gaming headsets). This mode opens the device
// in its native mix format and downmixes to stereo.
//
// --exclude <a.exe,b.exe,...> [--fallback-pid <pid>]: everything playing on
// the computer except one app, using process loopback (Windows 10 2004+ /
// Windows 11), which captures the system mix minus one process tree. The tree
// is the running instance of the named apps (Discord: viewers who are in the
// same voice call must not hear themselves), or <pid> (ScreenShare itself)
// while none of them is running. The helper rescans every 2 s and switches
// when the app starts or quits. Windows converts to 48 kHz stereo itself.
//
// Output on stdout:
//
//   header: "SSA1" | u32 sample rate | u16 channels (always 2)   (little endian)
//   then:   interleaved float32 stereo frames, forever
//
// Diagnostics go to stderr. The process exits when stdin closes (the app went
// away), when the device is invalidated (exit code 2), or, before writing the
// header, when process loopback is not available on this Windows (exit code 3).
//
// Built with the C# 5 compiler that ships with .NET Framework 4 (see
// scripts/build-win-audio.cjs); no NuGet packages or SDK required.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace ScreenShare.AudioCapture
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    // Marker: ActivateAudioInterfaceAsync requires an agile completion handler.
    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ClassInterface(ClassInterfaceType.None), ComVisible(true)]
    public class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            Done.Set();
        }
    }

    // PROPVARIANT holding a VT_BLOB (the only kind ActivateAudioInterfaceAsync needs here).
    [StructLayout(LayoutKind.Sequential)]
    struct PropVariantBlob
    {
        public ushort vt;
        public ushort reserved1, reserved2, reserved3;
        public uint cbSize;
        public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    // One open WASAPI capture stream and the format it delivers.
    sealed class Capture : IDisposable
    {
        public IAudioClient Client;
        public IAudioCaptureClient Reader;
        public int Channels, Rate, BlockAlign, Bits;
        public uint ChannelMask;
        public bool IsFloat;
        public float[] LeftGain, RightGain;
        // Signalled when data is ready (process loopback only; null otherwise).
        public AutoResetEvent Ready;
        public IntPtr Format;
        public bool FormatIsCoTaskMem;

        public void Dispose()
        {
            if (Client != null)
            {
                try { Client.Stop(); } catch { }
                try { Marshal.ReleaseComObject(Client); } catch { }
                Client = null;
            }
            if (Reader != null)
            {
                try { Marshal.ReleaseComObject(Reader); } catch { }
                Reader = null;
            }
            if (Format != IntPtr.Zero)
            {
                if (FormatIsCoTaskMem) Marshal.FreeCoTaskMem(Format); else Marshal.FreeHGlobal(Format);
                Format = IntPtr.Zero;
            }
            if (Ready != null)
            {
                Ready.Dispose();
                Ready = null;
            }
        }
    }

    static class Program
    {
        const int eRender = 0;
        const int eConsole = 0;
        const int CLSCTX_ALL = 23;
        const int AUDCLNT_SHAREMODE_SHARED = 0;
        const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = unchecked((int)0x80000000);
        const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        const int AUDCLNT_E_DEVICE_INVALIDATED = unchecked((int)0x88890004);
        const ushort WAVE_FORMAT_PCM = 1;
        const ushort WAVE_FORMAT_IEEE_FLOAT = 3;
        const ushort WAVE_FORMAT_EXTENSIBLE = 0xFFFE;
        const ushort VT_BLOB = 65;
        const int AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
        const int PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1;
        const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";
        const uint TH32CS_SNAPPROCESS = 0x2;
        const int PROCESS_LOOPBACK_RATE = 48000;
        const int RESCAN_MS = 2000;
        const int EXIT_NO_PROCESS_LOOPBACK = 3;
        static readonly Guid SubtypeFloat = new Guid("00000003-0000-0010-8000-00aa00389b71");

        static volatile bool running = true;
        static byte[] raw = new byte[0];
        static byte[] outBuf = new byte[0];

        [DllImport("Mmdevapi.dll", ExactSpelling = true)]
        static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            ref PropVariantBlob activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        [MTAThread]
        static int Main(string[] args)
        {
            // Stop when the parent closes our stdin (or dies).
            var watcher = new Thread(() =>
            {
                try { var stdin = Console.OpenStandardInput(); var buf = new byte[64]; while (stdin.Read(buf, 0, buf.Length) > 0) { } }
                catch { }
                running = false;
            });
            watcher.IsBackground = true;
            watcher.Start();

            try
            {
                string[] exclude = null;
                uint fallbackPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
                for (int i = 0; i + 1 < args.Length; i += 2)
                {
                    if (args[i] == "--exclude") exclude = args[i + 1].Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                    else if (args[i] == "--fallback-pid") fallbackPid = uint.Parse(args[i + 1]);
                }
                return Run(exclude, fallbackPid);
            }
            catch (Exception e) { Console.Error.WriteLine("fatal: " + e.Message); return 1; }
        }

        static void Check(int hr, string what)
        {
            if (hr < 0) throw new Exception(string.Format("{0} failed: 0x{1:X8}", what, hr));
        }

        static int Run(string[] exclude, uint fallbackPid)
        {
            Capture capture;
            uint target = 0;
            if (exclude == null)
            {
                capture = OpenEndpointLoopback();
            }
            else
            {
                string name;
                try
                {
                    target = FindTarget(exclude, fallbackPid, out name);
                    capture = OpenProcessLoopback(target);
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine("process loopback unavailable: " + e.Message);
                    return EXIT_NO_PROCESS_LOOPBACK;
                }
                Console.Error.WriteLine(DescribeTarget(target, name));
            }
            int rate = capture.Rate;

            var stdout = Console.OpenStandardOutput();
            var header = new byte[10];
            header[0] = (byte)'S'; header[1] = (byte)'S'; header[2] = (byte)'A'; header[3] = (byte)'1';
            BitConverter.GetBytes((uint)rate).CopyTo(header, 4);
            BitConverter.GetBytes((ushort)2).CopyTo(header, 8);
            stdout.Write(header, 0, header.Length);
            stdout.Flush();

            var clock = System.Diagnostics.Stopwatch.StartNew();
            var sinceScan = System.Diagnostics.Stopwatch.StartNew();
            long framesWritten = 0;
            uint failedTarget = 0;

            try
            {
                Check(capture.Client.Start(), "Start");
                while (running)
                {
                    if (capture.Ready != null) capture.Ready.WaitOne(10);
                    else Thread.Sleep(5);
                    int frames = Drain(capture, stdout);
                    if (frames < 0) { Console.Error.WriteLine("device invalidated"); return 2; }
                    framesWritten += frames;

                    // Follow the excluded app: it may start, quit or restart while we share.
                    if (exclude != null && sinceScan.ElapsedMilliseconds >= RESCAN_MS)
                    {
                        sinceScan = System.Diagnostics.Stopwatch.StartNew();
                        string name = null;
                        uint next = target;
                        try { next = FindTarget(exclude, fallbackPid, out name); }
                        catch (Exception e) { Console.Error.WriteLine("process scan failed: " + e.Message); }
                        if (next != target)
                        {
                            try
                            {
                                var fresh = OpenProcessLoopback(next);
                                try { Check(fresh.Client.Start(), "Start"); }
                                catch { fresh.Dispose(); throw; }
                                capture.Dispose();
                                capture = fresh;
                                target = next;
                                failedTarget = 0;
                                Console.Error.WriteLine(DescribeTarget(target, name));
                            }
                            catch (Exception e)
                            {
                                // Keep the current capture and retry on the next scan; log once per target.
                                if (next != failedTarget) Console.Error.WriteLine("switching capture failed: " + e.Message);
                                failedTarget = next;
                            }
                        }
                    }

                    // Windows delivers nothing while no app is playing; send real
                    // silence instead so the stream keeps its timing.
                    long expected = clock.ElapsedMilliseconds * rate / 1000;
                    if (frames == 0 && expected - framesWritten > rate / 50)
                    {
                        int fill = (int)(expected - framesWritten);
                        int need = fill * 8;
                        if (outBuf.Length < need) outBuf = new byte[need];
                        Array.Clear(outBuf, 0, need);
                        stdout.Write(outBuf, 0, need);
                        framesWritten += fill;
                    }
                    else if (framesWritten > expected)
                    {
                        // Device clock ran ahead of ours; resync so silence filling stays correct.
                        clock = System.Diagnostics.Stopwatch.StartNew();
                        framesWritten = 0;
                    }
                    stdout.Flush();
                }
            }
            catch (IOException)
            {
                // stdout closed: the app is gone.
            }
            finally
            {
                capture.Dispose();
            }
            return 0;
        }

        // Write every packet that is ready as stereo float32. Returns the frames
        // written, or -1 when the device went away.
        static int Drain(Capture capture, Stream stdout)
        {
            int total = 0;
            uint packet;
            int hr = capture.Reader.GetNextPacketSize(out packet);
            if (hr == AUDCLNT_E_DEVICE_INVALIDATED) return -1;
            Check(hr, "GetNextPacketSize");
            while (packet > 0)
            {
                IntPtr data; uint frames; uint flags; ulong devPos, qpcPos;
                Check(capture.Reader.GetBuffer(out data, out frames, out flags, out devPos, out qpcPos), "GetBuffer");
                int need = (int)frames * 8;
                if (outBuf.Length < need) outBuf = new byte[need];
                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                {
                    Array.Clear(outBuf, 0, need);
                }
                else
                {
                    int bytes = (int)frames * capture.BlockAlign;
                    if (raw.Length < bytes) raw = new byte[bytes];
                    Marshal.Copy(data, raw, 0, bytes);
                    Downmix(raw, (int)frames, capture, outBuf);
                }
                Check(capture.Reader.ReleaseBuffer(frames), "ReleaseBuffer");
                stdout.Write(outBuf, 0, need);
                total += (int)frames;
                hr = capture.Reader.GetNextPacketSize(out packet);
                if (hr == AUDCLNT_E_DEVICE_INVALIDATED) return -1;
                Check(hr, "GetNextPacketSize");
            }
            return total;
        }

        // Loopback of the default output device, in its own mix format.
        static Capture OpenEndpointLoopback()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Check(enumerator.GetDefaultAudioEndpoint(eRender, eConsole, out device), "GetDefaultAudioEndpoint");
            var iidAudioClient = typeof(IAudioClient).GUID;
            object clientObj;
            Check(device.Activate(ref iidAudioClient, CLSCTX_ALL, IntPtr.Zero, out clientObj), "Activate");

            var capture = new Capture();
            capture.Client = (IAudioClient)clientObj;
            Check(capture.Client.GetMixFormat(out capture.Format), "GetMixFormat");
            capture.FormatIsCoTaskMem = true;
            ReadFormat(capture);
            Console.Error.WriteLine(string.Format("mix format: {0} ch, {1} Hz, {2}-bit {3}, mask 0x{4:X}",
                capture.Channels, capture.Rate, capture.Bits, capture.IsFloat ? "float" : "pcm", capture.ChannelMask));

            // Loopback must use the device mix format in shared mode. 200 ms buffer.
            Check(capture.Client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2000000, 0, capture.Format, IntPtr.Zero), "Initialize");
            OpenReader(capture);
            return capture;
        }

        // Loopback of the whole system mix except the process tree rooted at `pid`.
        static Capture OpenProcessLoopback(uint pid)
        {
            // Process loopback has no mix format of its own: ask for 48 kHz stereo
            // (float, else 16-bit PCM) and let Windows convert.
            Exception last = null;
            foreach (var isFloat in new[] { true, false })
            {
                var capture = new Capture();
                try
                {
                    capture.Client = ActivateProcessLoopback(pid);
                    capture.Format = BuildStereoFormat(isFloat);
                    ReadFormat(capture);
                    int flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
                    Check(capture.Client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 2000000, 0, capture.Format, IntPtr.Zero), "Initialize");
                    capture.Ready = new AutoResetEvent(false);
                    Check(capture.Client.SetEventHandle(capture.Ready.SafeWaitHandle.DangerousGetHandle()), "SetEventHandle");
                    OpenReader(capture);
                    return capture;
                }
                catch (Exception e)
                {
                    capture.Dispose();
                    last = e;
                }
            }
            throw last;
        }

        static IAudioClient ActivateProcessLoopback(uint pid)
        {
            // AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType; { TargetProcessId; ProcessLoopbackMode } }
            IntPtr parameters = Marshal.AllocHGlobal(12);
            try
            {
                Marshal.WriteInt32(parameters, 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK);
                Marshal.WriteInt32(parameters, 4, unchecked((int)pid));
                Marshal.WriteInt32(parameters, 8, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);
                var blob = new PropVariantBlob();
                blob.vt = VT_BLOB;
                blob.cbSize = 12;
                blob.pBlobData = parameters;

                var handler = new ActivationHandler();
                IActivateAudioInterfaceAsyncOperation operation;
                Check(ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, typeof(IAudioClient).GUID, ref blob, handler, out operation),
                    "ActivateAudioInterfaceAsync");
                if (!handler.Done.WaitOne(5000))
                {
                    parameters = IntPtr.Zero; // activation may still read it: leak rather than free
                    throw new Exception("process loopback activation timed out");
                }
                int result;
                object client;
                Check(operation.GetActivateResult(out result, out client), "GetActivateResult");
                Check(result, "process loopback activation");
                return (IAudioClient)client;
            }
            finally
            {
                if (parameters != IntPtr.Zero) Marshal.FreeHGlobal(parameters);
            }
        }

        // WAVEFORMATEX for 48 kHz stereo, float32 or 16-bit PCM.
        static IntPtr BuildStereoFormat(bool isFloat)
        {
            int bits = isFloat ? 32 : 16;
            int blockAlign = 2 * bits / 8;
            IntPtr format = Marshal.AllocHGlobal(18);
            Marshal.WriteInt16(format, 0, unchecked((short)(isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM)));
            Marshal.WriteInt16(format, 2, 2);
            Marshal.WriteInt32(format, 4, PROCESS_LOOPBACK_RATE);
            Marshal.WriteInt32(format, 8, PROCESS_LOOPBACK_RATE * blockAlign);
            Marshal.WriteInt16(format, 12, (short)blockAlign);
            Marshal.WriteInt16(format, 14, (short)bits);
            Marshal.WriteInt16(format, 16, 0);
            return format;
        }

        static void ReadFormat(Capture capture)
        {
            IntPtr f = capture.Format;
            ushort tag = (ushort)Marshal.ReadInt16(f, 0);
            capture.Channels = Marshal.ReadInt16(f, 2);
            capture.Rate = Marshal.ReadInt32(f, 4);
            capture.BlockAlign = Marshal.ReadInt16(f, 12);
            capture.Bits = Marshal.ReadInt16(f, 14);
            capture.ChannelMask = 0;
            capture.IsFloat = tag == WAVE_FORMAT_IEEE_FLOAT;
            if (tag == WAVE_FORMAT_EXTENSIBLE)
            {
                capture.ChannelMask = (uint)Marshal.ReadInt32(f, 20);
                var sub = new byte[16];
                Marshal.Copy(IntPtr.Add(f, 24), sub, 0, 16);
                capture.IsFloat = new Guid(sub) == SubtypeFloat;
            }
            else if (tag != WAVE_FORMAT_PCM && tag != WAVE_FORMAT_IEEE_FLOAT)
            {
                throw new Exception("unsupported mix format tag 0x" + tag.ToString("X"));
            }
            BuildDownmix(capture.Channels, capture.ChannelMask, out capture.LeftGain, out capture.RightGain);
        }

        static void OpenReader(Capture capture)
        {
            var iidCapture = typeof(IAudioCaptureClient).GUID;
            object reader;
            Check(capture.Client.GetService(ref iidCapture, out reader), "GetService");
            capture.Reader = (IAudioCaptureClient)reader;
        }

        // The process to exclude: the root of the running app named in `names`
        // (its children are renderer, GPU and audio processes), else `fallback`.
        static uint FindTarget(string[] names, uint fallback, out string name)
        {
            name = null;
            var wanted = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var n in names) wanted[n] = true;

            // pid -> parent pid, for processes with a wanted name.
            var parents = new Dictionary<uint, uint>();
            var exeNames = new Dictionary<uint, string>();
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == new IntPtr(-1)) return fallback;
            try
            {
                var entry = new ProcessEntry();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
                bool ok = Process32FirstW(snapshot, ref entry);
                while (ok)
                {
                    if (entry.szExeFile != null && wanted.ContainsKey(entry.szExeFile))
                    {
                        parents[entry.th32ProcessID] = entry.th32ParentProcessID;
                        exeNames[entry.th32ProcessID] = entry.szExeFile;
                    }
                    ok = Process32NextW(snapshot, ref entry);
                }
            }
            finally
            {
                CloseHandle(snapshot);
            }

            uint best = PickRoot(parents);
            if (best == 0) return fallback;
            name = exeNames[best];
            return best;
        }

        // Given pid -> parent pid for one app's processes, the root of its
        // biggest process tree (0 if none). A root's parent is not one of the
        // app's processes (Discord's launcher exits after starting it). If
        // several instances run, the one with the most processes is the real
        // app, not a leftover crash handler.
        internal static uint PickRoot(Dictionary<uint, uint> parents)
        {
            var treeSize = new Dictionary<uint, int>();
            foreach (var pid in parents.Keys)
            {
                uint root = pid;
                for (int depth = 0; depth < 64 && parents.ContainsKey(parents[root]); depth++) root = parents[root];
                if (parents.ContainsKey(parents[root])) continue; // parent cycle from pid reuse
                int count;
                treeSize.TryGetValue(root, out count);
                treeSize[root] = count + 1;
            }
            uint best = 0;
            int bestCount = 0;
            foreach (var pair in treeSize)
            {
                if (pair.Value > bestCount) { best = pair.Key; bestCount = pair.Value; }
            }
            return best;
        }

        static string DescribeTarget(uint pid, string name)
        {
            return name != null
                ? string.Format("excluding {0} (pid {1}) and its child processes", name, pid)
                : string.Format("excluded app not running; excluding pid {0}", pid);
        }

        // Standard downmix: centre and surrounds at -3 dB, LFE dropped.
        static void BuildDownmix(int channels, uint mask, out float[] left, out float[] right)
        {
            left = new float[channels];
            right = new float[channels];
            if (channels == 1) { left[0] = 1; right[0] = 1; return; }
            if (mask == 0)
            {
                // Assume the default speaker order for this channel count.
                uint[] defaults = { 0x0, 0x4, 0x3, 0x7, 0x33, 0x37, 0x3F, 0x13F, 0x63F };
                mask = channels < defaults.Length ? defaults[channels] : 0x63F;
            }
            const float h = 0.7071f;
            int ch = 0;
            for (int bit = 0; bit < 32 && ch < channels; bit++)
            {
                uint speaker = 1u << bit;
                if ((mask & speaker) == 0) continue;
                switch (speaker)
                {
                    case 0x1: left[ch] = 1; break;                  // front left
                    case 0x2: right[ch] = 1; break;                 // front right
                    case 0x4: left[ch] = h; right[ch] = h; break;   // front centre
                    case 0x8: break;                                // LFE
                    case 0x10: left[ch] = h; break;                 // back left
                    case 0x20: right[ch] = h; break;                // back right
                    case 0x40: left[ch] = 1; break;                 // front left of centre
                    case 0x80: right[ch] = 1; break;                // front right of centre
                    case 0x100: left[ch] = 0.5f; right[ch] = 0.5f; break; // back centre
                    case 0x200: left[ch] = h; break;                // side left
                    case 0x400: right[ch] = h; break;               // side right
                    default: left[ch] = 0.5f; right[ch] = 0.5f; break;    // top speakers
                }
                ch++;
            }
            // Channels beyond the mask (shouldn't happen) are ignored.
        }

        static void Downmix(byte[] raw, int frames, Capture capture, byte[] output)
        {
            int channels = capture.Channels;
            int blockAlign = capture.BlockAlign;
            int bits = capture.Bits;
            bool isFloat = capture.IsFloat;
            float[] left = capture.LeftGain;
            float[] right = capture.RightGain;
            int bytesPerSample = bits / 8;
            for (int f = 0; f < frames; f++)
            {
                float l = 0, r = 0;
                int frameOffset = f * blockAlign;
                for (int c = 0; c < channels; c++)
                {
                    int o = frameOffset + c * bytesPerSample;
                    float s;
                    if (isFloat) s = BitConverter.ToSingle(raw, o);
                    else if (bits == 16) s = BitConverter.ToInt16(raw, o) / 32768f;
                    else if (bits == 24) s = ((raw[o] << 8 | raw[o + 1] << 16 | raw[o + 2] << 24) >> 8) / 8388608f;
                    else if (bits == 32) s = BitConverter.ToInt32(raw, o) / 2147483648f;
                    else s = 0;
                    l += s * left[c];
                    r += s * right[c];
                }
                if (l > 1) l = 1; else if (l < -1) l = -1;
                if (r > 1) r = 1; else if (r < -1) r = -1;
                Buffer.BlockCopy(BitConverter.GetBytes(l), 0, output, f * 8, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(r), 0, output, f * 8 + 4, 4);
            }
        }
    }
}
