using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

// Private, line-delimited JSON protocol over inherited pipes. No TCP endpoint,
// shell execution, UIAccess, elevation or arbitrary native calls.
static class Program {
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union value; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h,int index,StringBuilder info,uint length,out uint needed);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("wtsapi32.dll")] static extern bool WTSQuerySessionInformation(IntPtr server,int session,int info,out IntPtr buffer,out int bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
    [DllImport("user32.dll")] static extern short VkKeyScan(char c);
    [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr h,out uint affinity);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point p,uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor,int type,out uint x,out uint y);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr t,int c,IntPtr data,int size,out int needed);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
    static Mutex? desktopLock;
    static bool owned;
    static bool cleanupFailed;
    static long lastStep;
    static readonly HashSet<ushort> heldKeys = new();
    static readonly HashSet<string> heldButtons = new();
    static readonly object gate = new();
    sealed class Refusal(string code,string detail,string execution="not_started") : Exception(detail) { public string Code=code; public string Execution=execution; }
    static Refusal Unsupported(string detail) => new("desktop-unsupported-operation",detail);
    static void Main() {
        // Only this thread owns/releases the Mutex. Read on a worker so an open
        // but silent parent pipe cannot prevent lease cleanup on the owner thread.
        // Console.In.ReadLineAsync may execute synchronously on its synchronized
        // reader, so Task.Run is intentional here.
        try {
            Task<string?>? read=null;
            while (true) {
                read ??= Task.Run(() => Console.ReadLine());
                if(!read.Wait(250)) {
                    lock(gate) { if(owned && Environment.TickCount64-lastStep>=15000) Release(); }
                    continue;
                }
                var line=read.GetAwaiter().GetResult(); read=null;
                if(line is null) break;
                long id=0;
                try {
                    using var doc=JsonDocument.Parse(line); var p=doc.RootElement; id=p.GetProperty("id").GetInt64();
                    object result; lock(gate) { result=Run(p); }
                    Console.WriteLine(JsonSerializer.Serialize(new { id,result }));
                } catch(Exception ex) {
                    var e=ex as Refusal ?? new Refusal("desktop-execution-failed","The native Windows operation failed","unknown");
                    lock(gate) { ReleaseInput(); }
                    Console.WriteLine(JsonSerializer.Serialize(new { id,error=new {code=e.Code,detail=e.Message,execution=e.Execution} }));
                }
            }
        } finally { lock(gate) { Release(); } }
    }
    static void Ready() {
        if(!WTSQuerySessionInformation(IntPtr.Zero,-1,8,out var state,out _)) { Release(); throw Unsupported("Cannot verify the interactive Windows session"); }
        try { if(Marshal.ReadInt32(state)!=0) { Release(); throw Unsupported("The Windows session is disconnected or locked"); } }
        finally { WTSFreeMemory(state); }
        var desktop=OpenInputDesktop(0,false,1);
        if(desktop==IntPtr.Zero) { Release(); throw Unsupported("Windows is locked or using a secure desktop"); }
        try { var name=new StringBuilder(256); if(!GetUserObjectInformation(desktop,2,name,512,out _) || name.ToString()!="Default") { Release(); throw Unsupported("Secure and non-default desktops are unsupported"); } }
        finally { CloseDesktop(desktop); }
        if(!Environment.UserInteractive) throw Unsupported("An interactive Windows session is required");
        if(!owned) throw new Refusal("desktop-not-active","The desktop lock is not held");
        if(Environment.TickCount64-lastStep>=15000) { Release(); throw new Refusal("desktop-not-active","Native desktop lease expired"); }
        lastStep=Environment.TickCount64;
    }
    static int Integrity(uint pid) {
        var process=OpenProcess(0x1000,false,pid);
        if(process==IntPtr.Zero) throw Unsupported("Cannot inspect target process permissions");
        IntPtr token=IntPtr.Zero, data=IntPtr.Zero;
        try {
            if(!OpenProcessToken(process,8,out token)) throw Unsupported("Cannot inspect target process permissions");
            GetTokenInformation(token,25,IntPtr.Zero,0,out int length); data=Marshal.AllocHGlobal(length);
            if(!GetTokenInformation(token,25,data,length,out _)) throw Unsupported("Cannot inspect target integrity");
            var sid=Marshal.ReadIntPtr(data); var count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));
            return Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));
        } finally { if(data!=IntPtr.Zero) Marshal.FreeHGlobal(data); if(token!=IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    static void Target(IntPtr window) {
        if(window==IntPtr.Zero) throw Unsupported("No interactive target window");
        GetWindowThreadProcessId(window,out uint pid);
        if(Integrity(pid)>Integrity((uint)Environment.ProcessId)) throw new Refusal("desktop-os-permission-required","Elevated windows cannot be controlled by Intent");
    }
    static void Send(Input input,bool cleanup=false) {
        if(!cleanup) Ready();
        if(SendInput(1,new[]{input},Marshal.SizeOf<Input>())!=1) {
            if(cleanup) cleanupFailed=true;
            else throw new Refusal("desktop-os-permission-required","Windows rejected native input (possibly a protected or elevated target)","unknown");
        }
    }
    static void MouseEvent(uint flags,uint data=0,bool cleanup=false) => Send(new Input {type=0,value=new Union {mouse=new Mouse {flags=flags,data=data}}},cleanup);
    static void Key(ushort key,bool down,bool cleanup=false) {
        uint extended=key is 0x21 or 0x22 or 0x23 or 0x24 or 0x25 or 0x26 or 0x27 or 0x28 or 0x2D or 0x2E or 0x5B ? 1u : 0u;
        Send(new Input {type=1,value=new Union {keyboard=new Keyboard {vk=key,flags=(down?0u:2u)|extended}}},cleanup);
        if(down) heldKeys.Add(key); else heldKeys.Remove(key);
    }
    static ushort Mapping(string key) {
        var named=new Dictionary<string,ushort>{{"Shift",0x10},{"Control",0x11},{"Alt",0x12},{"Meta",0x5B},{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"Insert",45},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34},{"ArrowUp",38},{"ArrowDown",40},{"ArrowLeft",37},{"ArrowRight",39},{"Space",32}};
        if(named.TryGetValue(key,out var value)) return value;
        if(key.StartsWith('F') && int.TryParse(key[1..],out int f) && f>=1 && f<=24) return (ushort)(111+f);
        if(key.Length==1) { short v=VkKeyScan(key[0]); if(v!=-1 && (v>>8)==0) return (ushort)(v&255); }
        throw Unsupported("This key has no unambiguous mapping in the active keyboard layout; use type for text");
    }
    static object[] Layout() => Screen.AllScreens.OrderBy(s=>s.DeviceName,StringComparer.Ordinal).Select(s => {
        var r=s.Bounds; var monitor=MonitorFromPoint(new Point{x=r.X,y=r.Y},2);
        if(GetDpiForMonitor(monitor,0,out uint dpi,out _)!=0) throw Unsupported("Monitor scaling could not be read");
        return (object)new {displayId=s.DeviceName,width=r.Width,height=r.Height,originX=r.X,originY=r.Y,scaleFactor=dpi/96.0};
    }).ToArray();
    static void ReleaseInput() {
        foreach(var key in heldKeys.ToArray()) Key(key,false,true);
        foreach(var button in heldButtons.ToArray()) MouseEvent(button=="right"?0x10u:4u,0,true);
        heldButtons.Clear();
    }
    static void Release() { ReleaseInput(); if(owned) { owned=false; desktopLock?.ReleaseMutex(); } desktopLock?.Dispose(); desktopLock=null; }
    static object Run(JsonElement p) {
        var op=p.GetProperty("operation").GetString();
        if(op=="identity") {
            var guid=Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography","MachineGuid",null)?.ToString() ?? throw Unsupported("Machine identity unavailable");
            var sid=System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value ?? throw Unsupported("User identity unavailable");
            return new {computerId=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(guid+":"+sid))).ToLowerInvariant(),computerName=Environment.MachineName,platform="windows"};
        }
        if(op=="release" || op=="releaseInput") {
            cleanupFailed=false;
            if(op=="release") Release(); else ReleaseInput();
            if(cleanupFailed) throw new Refusal("desktop-execution-failed","Windows could not confirm release of held input","unknown");
            return new {ok=true};
        }
        if(op=="acquire") {
            if(owned) throw new Refusal("desktop-busy","Desktop already controlled");
            desktopLock=new Mutex(false,@"Local\IntentDesktopControl");
            try { owned=desktopLock.WaitOne(0); } catch(AbandonedMutexException) { owned=true; }
            if(!owned) { desktopLock.Dispose(); desktopLock=null; throw new Refusal("desktop-busy","Desktop already controlled"); }
            lastStep=Environment.TickCount64; Ready(); return new {ok=true};
        }
        Ready();
        if(op=="check") return new {ok=true};
        if(op=="layout") return Layout();
        if(op=="capture" || op=="validateExclusion") {
            if(!OperatingSystem.IsWindowsVersionAtLeast(10,0,19041)) throw Unsupported("Capture exclusion requires Windows 10 version 2004 or newer");
            var excluded=p.GetProperty("excludedWindows").EnumerateArray().Select(e=>new IntPtr(long.Parse(e.GetString()!))).ToArray();
            if(excluded.Length==0 || excluded.Any(h=>!GetWindowDisplayAffinity(h,out var affinity)||affinity!=0x11)) throw Unsupported("The desktop indicator cannot be excluded from capture");
            if(op=="validateExclusion") return new {ok=true};
            var result=new List<object>();
            foreach(var d in Layout()) {
                Ready(); var e=JsonSerializer.SerializeToElement(d); int x=e.GetProperty("originX").GetInt32(),y=e.GetProperty("originY").GetInt32(),w=e.GetProperty("width").GetInt32(),h=e.GetProperty("height").GetInt32();
                using var bitmap=new Bitmap(w,h,PixelFormat.Format32bppArgb); using(var graphics=Graphics.FromImage(bitmap)) graphics.CopyFromScreen(x,y,0,0,new Size(w,h),CopyPixelOperation.SourceCopy);
                using var stream=new MemoryStream(); bitmap.Save(stream,ImageFormat.Png);
                var map=JsonSerializer.Deserialize<Dictionary<string,object>>(e.GetRawText())!; map["data"]=Convert.ToBase64String(stream.ToArray()); result.Add(map);
            }
            return result;
        }
        if(op=="move") {
            var d=p.GetProperty("display"); var screen=Screen.AllScreens.SingleOrDefault(s=>s.DeviceName==d.GetProperty("displayId").GetString()) ?? throw new Refusal("desktop-stale-layout","Display disconnected");
            var r=screen.Bounds;
            if(r.Width!=d.GetProperty("width").GetInt32()||r.Height!=d.GetProperty("height").GetInt32()||r.X!=d.GetProperty("originX").GetInt32()||r.Y!=d.GetProperty("originY").GetInt32()) throw new Refusal("desktop-stale-layout","Display geometry changed");
            int x=r.X+(int)p.GetProperty("x").GetDouble(),y=r.Y+(int)p.GetProperty("y").GetDouble();
            if(!r.Contains(x,y)) throw Unsupported("Pointer is outside display"); Target(WindowFromPoint(new Point{x=x,y=y}));
            int vx=GetSystemMetrics(76),vy=GetSystemMetrics(77),vw=GetSystemMetrics(78),vh=GetSystemMetrics(79);
            Send(new Input {type=0,value=new Union {mouse=new Mouse {x=(int)Math.Round((x-vx)*65535.0/(vw-1)),y=(int)Math.Round((y-vy)*65535.0/(vh-1)),flags=0xC001}}});
        } else if(op=="button") {
            GetCursorPos(out var cursor); Target(WindowFromPoint(cursor));
            var button=p.GetProperty("button").GetString()!; bool down=p.GetProperty("down").GetBoolean();
            MouseEvent(button=="right"?(down?8u:16u):(down?2u:4u)); if(down) heldButtons.Add(button); else heldButtons.Remove(button);
        } else if(op=="key" || op=="validateKey") {
            Target(GetForegroundWindow()); var key=Mapping(p.GetProperty("key").GetString()!); if(op=="key") Key(key,p.GetProperty("down").GetBoolean());
        } else if(op=="text") {
            Target(GetForegroundWindow());
            foreach(char c in p.GetProperty("text").GetString()!) {
                Send(new Input {type=1,value=new Union {keyboard=new Keyboard {scan=c,flags=4}}});
                Send(new Input {type=1,value=new Union {keyboard=new Keyboard {scan=c,flags=6}}});
            }
        } else if(op=="scroll") {
            GetCursorPos(out var cursor); Target(WindowFromPoint(cursor));
            // Windows wheel units are 120 per detent. Preserve fractional deltas
            // across calls (one detent conventionally scrolls 3 x 16px lines).
            Wheel(p.GetProperty("deltaX").GetDouble(),true); Wheel(-p.GetProperty("deltaY").GetDouble(),false);
        } else throw Unsupported("Unknown helper operation");
        return new {ok=true};
    }
    static double wheelX,wheelY;
    static void Wheel(double pixels,bool horizontal) {
        if(!double.IsFinite(pixels) || Math.Abs(pixels)>int.MaxValue/3.0) throw Unsupported("Scroll delta exceeds native wheel limits");
        ref double remainder=ref (horizontal?ref wheelX:ref wheelY); remainder+=pixels*120/48;
        int units=(int)Math.Clamp(Math.Truncate(remainder),int.MinValue,int.MaxValue); remainder-=units;
        if(units!=0) MouseEvent(horizontal?0x1000u:0x800u,unchecked((uint)units));
    }
}
