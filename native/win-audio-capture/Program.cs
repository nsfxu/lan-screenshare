// win-audio-capture: WASAPI loopback capture of the default output device.
//
// Chromium's own loopback opens the device as stereo, which Windows rejects
// (AUDCLNT_E_UNSUPPORTED_FORMAT) when the output device runs in a surround
// mix format (5.1 / 7.1, common with gaming headsets). This helper opens the
// device in its native mix format, downmixes to stereo and streams it to the
// app over stdout:
//
//   header: "SSA1" | u32 sample rate | u16 channels (always 2)   (little endian)
//   then:   interleaved float32 stereo frames, forever
//
// Diagnostics go to stderr. The process exits when stdin closes (the app went
// away) or when the device is invalidated (exit code 2).
//
// Built with the C# 5 compiler that ships with .NET Framework 4 (see
// scripts/build-win-audio.cjs); no NuGet packages or SDK required.

using System;
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

    static class Program
    {
        const int eRender = 0;
        const int eConsole = 0;
        const int CLSCTX_ALL = 23;
        const int AUDCLNT_SHAREMODE_SHARED = 0;
        const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        const int AUDCLNT_E_DEVICE_INVALIDATED = unchecked((int)0x88890004);
        const ushort WAVE_FORMAT_PCM = 1;
        const ushort WAVE_FORMAT_IEEE_FLOAT = 3;
        const ushort WAVE_FORMAT_EXTENSIBLE = 0xFFFE;
        static readonly Guid SubtypeFloat = new Guid("00000003-0000-0010-8000-00aa00389b71");

        static volatile bool running = true;

        static int Main()
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

            try { return Run(); }
            catch (Exception e) { Console.Error.WriteLine("fatal: " + e.Message); return 1; }
        }

        static void Check(int hr, string what)
        {
            if (hr < 0) throw new Exception(string.Format("{0} failed: 0x{1:X8}", what, hr));
        }

        static int Run()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Check(enumerator.GetDefaultAudioEndpoint(eRender, eConsole, out device), "GetDefaultAudioEndpoint");
            var iidAudioClient = typeof(IAudioClient).GUID;
            object clientObj;
            Check(device.Activate(ref iidAudioClient, CLSCTX_ALL, IntPtr.Zero, out clientObj), "Activate");
            var client = (IAudioClient)clientObj;

            IntPtr mix;
            Check(client.GetMixFormat(out mix), "GetMixFormat");
            ushort tag = (ushort)Marshal.ReadInt16(mix, 0);
            int channels = Marshal.ReadInt16(mix, 2);
            int rate = Marshal.ReadInt32(mix, 4);
            int blockAlign = Marshal.ReadInt16(mix, 12);
            int bits = Marshal.ReadInt16(mix, 14);
            uint channelMask = 0;
            bool isFloat = tag == WAVE_FORMAT_IEEE_FLOAT;
            if (tag == WAVE_FORMAT_EXTENSIBLE)
            {
                channelMask = (uint)Marshal.ReadInt32(mix, 20);
                var sub = new byte[16];
                Marshal.Copy(IntPtr.Add(mix, 24), sub, 0, 16);
                isFloat = new Guid(sub) == SubtypeFloat;
            }
            else if (tag != WAVE_FORMAT_PCM && tag != WAVE_FORMAT_IEEE_FLOAT)
            {
                throw new Exception("unsupported mix format tag 0x" + tag.ToString("X"));
            }
            Console.Error.WriteLine(string.Format("mix format: {0} ch, {1} Hz, {2}-bit {3}, mask 0x{4:X}",
                channels, rate, bits, isFloat ? "float" : "pcm", channelMask));

            // Loopback must use the device mix format in shared mode. 200 ms buffer.
            Check(client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2000000, 0, mix, IntPtr.Zero), "Initialize");
            var iidCapture = typeof(IAudioCaptureClient).GUID;
            object captureObj;
            Check(client.GetService(ref iidCapture, out captureObj), "GetService");
            var capture = (IAudioCaptureClient)captureObj;

            float[] leftGain, rightGain;
            BuildDownmix(channels, channelMask, out leftGain, out rightGain);

            var stdout = Console.OpenStandardOutput();
            var header = new byte[10];
            header[0] = (byte)'S'; header[1] = (byte)'S'; header[2] = (byte)'A'; header[3] = (byte)'1';
            BitConverter.GetBytes((uint)rate).CopyTo(header, 4);
            BitConverter.GetBytes((ushort)2).CopyTo(header, 8);
            stdout.Write(header, 0, header.Length);
            stdout.Flush();

            Check(client.Start(), "Start");
            var raw = new byte[0];
            var outBuf = new byte[0];
            var clock = System.Diagnostics.Stopwatch.StartNew();
            long framesWritten = 0;

            try
            {
                while (running)
                {
                    Thread.Sleep(5);
                    bool gotData = false;
                    uint packet;
                    int hr = capture.GetNextPacketSize(out packet);
                    if (hr == AUDCLNT_E_DEVICE_INVALIDATED) { Console.Error.WriteLine("device invalidated"); return 2; }
                    Check(hr, "GetNextPacketSize");
                    while (packet > 0)
                    {
                        IntPtr data; uint frames; uint flags; ulong devPos, qpcPos;
                        Check(capture.GetBuffer(out data, out frames, out flags, out devPos, out qpcPos), "GetBuffer");
                        int need = (int)frames * 8;
                        if (outBuf.Length < need) outBuf = new byte[need];
                        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                        {
                            Array.Clear(outBuf, 0, need);
                        }
                        else
                        {
                            int bytes = (int)frames * blockAlign;
                            if (raw.Length < bytes) raw = new byte[bytes];
                            Marshal.Copy(data, raw, 0, bytes);
                            Downmix(raw, (int)frames, channels, blockAlign, bits, isFloat, leftGain, rightGain, outBuf);
                        }
                        Check(capture.ReleaseBuffer(frames), "ReleaseBuffer");
                        stdout.Write(outBuf, 0, need);
                        framesWritten += frames;
                        gotData = true;
                        Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
                    }
                    // Windows delivers nothing while no app is playing; send real
                    // silence instead so the stream keeps its timing.
                    long expected = clock.ElapsedMilliseconds * rate / 1000;
                    if (!gotData && expected - framesWritten > rate / 50)
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
                client.Stop();
                Marshal.FreeCoTaskMem(mix);
            }
            return 0;
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

        static void Downmix(byte[] raw, int frames, int channels, int blockAlign, int bits, bool isFloat,
            float[] left, float[] right, byte[] output)
        {
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
