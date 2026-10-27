using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

// Runs only on an isolated Windows test desktop. Observes actual window input;
// it does not substitute for Electron, UAC or mixed-monitor qualification.
static class Program {
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h,string name);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h,string name);
    static long Identity(Form f) => GetProp(f.Handle,"IntentDesktopWindowIdentity").ToInt64();
    static string helper = "";
    static int result = 1;
    [STAThread] static int Main(string[] args) {
        helper = Path.GetFullPath(args.Single());
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        using var target = new Form { Text="Intent native desktop functional test", StartPosition=FormStartPosition.Manual, Location=new Point(100,100), ClientSize=new Size(640,480), BackColor=Color.CornflowerBlue };
        target.Shown += async (_,_) => {
            try { await Run(target); result=0; Console.WriteLine("PASS: native Windows input, capture, exclusion, window metadata, focusWindow, exclusivity and EOF cleanup"); }
            catch(Exception e) { Console.Error.WriteLine(e); }
            finally { target.Close(); }
        };
        Application.Run(target);
        return result;
    }
    sealed class Peer : IDisposable {
        readonly Process process;
        long id;
        public Peer() {
            process=Process.Start(new ProcessStartInfo(helper) {UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,CreateNoWindow=true}) ?? throw new Exception("Helper failed to start");
        }
        public async Task<JsonElement> Call(string op, object? fields=null, string? expectedError=null) {
            var request=fields is null ? new Dictionary<string,object>() : JsonSerializer.Deserialize<Dictionary<string,object>>(JsonSerializer.Serialize(fields))!;
            request["operation"]=op; request["id"]=++id;
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request));
            var line=await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) ?? throw new Exception("Helper exited unexpectedly");
            var response=JsonSerializer.Deserialize<JsonElement>(line);
            Require(response.GetProperty("id").GetInt64()==id,"Mismatched helper response");
            if(expectedError is not null) { Require(response.GetProperty("error").GetProperty("code").GetString()==expectedError,"Wrong refusal"); return response; }
            if(response.TryGetProperty("error",out var error)) throw new Exception(error.GetRawText());
            return response.GetProperty("result").Clone();
        }
        public async Task End() { process.StandardInput.Close(); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); Require(process.ExitCode==0,"Helper failed on EOF"); }
        public void Dispose() { if(!process.HasExited) { process.StandardInput.Close(); if(!process.WaitForExit(3000)) process.Kill(true); } process.Dispose(); }
    }
    static void Require(bool ok,string message) { if(!ok) throw new Exception(message); }
    static async Task Observe(Func<bool> condition,string description) {
        for(int i=0;i<60;i++) { if(condition()) return; await Task.Delay(50); }
        throw new Exception("No native evidence for " + description);
    }
    static string Handle(Form f) => f.Handle.ToInt64().ToString();
    // Helper handles are "<hwnd>.<generation>"; compare the HWND part.
    static string Hwnd(JsonElement w,string property="handle") => w.GetProperty(property).GetString()!.Split('.')[0];
    static string Listed(JsonElement state,Form f) => state.GetProperty("windows").EnumerateArray().Single(w=>Hwnd(w)==Handle(f)).GetProperty("handle").GetString()!;
    static async Task WindowTargets(Peer peer,Form target,Form overlay,Screen screen,JsonElement display,JsonElement layout,string[] excluded) {
        target.Activate(); await Task.Delay(250);
        var state=await peer.Call("windows",new {excludedWindows=excluded,display,layout});
        var listed=state.GetProperty("windows").EnumerateArray().ToList();
        Require(!listed.Any(w=>Hwnd(w)==Handle(overlay)),"Overlay window leaked into window metadata");
        var mine=listed.SingleOrDefault(w=>Hwnd(w)==Handle(target));
        Require(mine.ValueKind==JsonValueKind.Object,"Target window missing from window metadata");
        Require(mine.GetProperty("pid").GetInt32()==Environment.ProcessId,"Window owner pid mismatch");
        Require(!string.IsNullOrEmpty(mine.GetProperty("appName").GetString()),"Missing application name");
        Require(mine.GetProperty("title").GetString()==target.Text,"Window title mismatch");
        // Identity tag survives only as long as this window instance.
        Require(Identity(target)!=0 && mine.GetProperty("handle").GetString()==Handle(target)+"."+Identity(target).ToString("x"),"Window identity tag missing or mismatched");
        int wx=mine.GetProperty("x").GetInt32()+screen.Bounds.X, wy=mine.GetProperty("y").GetInt32()+screen.Bounds.Y;
        int ww=mine.GetProperty("width").GetInt32(), wh=mine.GetProperty("height").GetInt32();
        var center=target.PointToScreen(new Point(target.ClientSize.Width/2,target.ClientSize.Height/2));
        Require(wx<=center.X && center.X<wx+ww && wy<=center.Y && center.Y<wy+wh,"Window frame is not in display-image pixels");
        Require(Math.Abs(ww-target.Width)<=24 && Math.Abs(wh-target.Height)<=24,"Window frame size mismatch");
        var front=state.GetProperty("frontmost");
        Require(front.GetProperty("pid").GetInt32()==Environment.ProcessId && Hwnd(front,"focusedHandle")==Handle(target),"Frontmost focused window mismatch");

        using var other=new Form { Text="Intent focusWindow test", StartPosition=FormStartPosition.Manual, Location=new Point(160,160), ClientSize=new Size(320,240) };
        other.Show(); other.Activate(); await Task.Delay(250);
        Require(GetForegroundWindow()==other.Handle,"Second test window did not activate");
        var behind=await peer.Call("windows",new {excludedWindows=excluded});
        var order=behind.GetProperty("windows").EnumerateArray().Select(w=>Hwnd(w)).ToList();
        Require(order.IndexOf(Handle(other))>=0 && order.IndexOf(Handle(other))<order.IndexOf(Handle(target)),"Windows are not listed front-to-back");
        var otherHandle=Listed(behind,other);
        await peer.Call("focusWindow",new {handle=Listed(behind,target),pid=Environment.ProcessId,excludedWindows=excluded});
        await Observe(()=>GetForegroundWindow()==target.Handle,"focusWindow raises and activates the target");
        other.WindowState=FormWindowState.Minimized; await Task.Delay(250);
        var after=await peer.Call("windows",new {excludedWindows=excluded});
        Require(!after.GetProperty("windows").EnumerateArray().Any(w=>Hwnd(w)==Handle(other)),"Minimized window listed as eligible");
        var minimized=await peer.Call("focusWindow",new {handle=otherHandle,pid=Environment.ProcessId,excludedWindows=excluded},"desktop-target-mismatch");
        Require(minimized.GetProperty("error").GetProperty("reason").GetString()=="window_unavailable","Wrong focusWindow refusal reason");
        Require(other.WindowState==FormWindowState.Minimized,"focusWindow restored a minimized window");
        await peer.Call("focusWindow",new {handle="0",pid=Environment.ProcessId,excludedWindows=excluded},"desktop-target-mismatch");
        // A destroyed window's handle (with its generation) never resolves again.
        var closing=new Form { Text="Intent closed window test", StartPosition=FormStartPosition.Manual, Location=new Point(200,200), ClientSize=new Size(200,150) };
        closing.Show(); await Task.Delay(250);
        var closingHandle=Listed(await peer.Call("windows",new {excludedWindows=excluded}),closing);
        closing.Close(); closing.Dispose(); await Task.Delay(250);
        var gone=await peer.Call("focusWindow",new {handle=closingHandle,pid=Environment.ProcessId,excludedWindows=excluded},"desktop-target-mismatch");
        Require(gone.GetProperty("error").GetProperty("reason").GetString()=="window_unavailable","Closed window handle resolved");
        // Deterministic recycled-HWND regression: a window that reuses a destroyed
        // window's HWND is, to the helper, that HWND without the old identity tag.
        // Simulate it on a live window: the old handle must stop resolving for
        // focus, and enumeration must report a new identity for the same HWND.
        var original=Listed(await peer.Call("windows",new {excludedWindows=excluded}),target);
        RemoveProp(target.Handle,"IntentDesktopWindowIdentity");
        var stale=await peer.Call("focusWindow",new {handle=original,pid=Environment.ProcessId,excludedWindows=excluded},"desktop-target-mismatch");
        Require(stale.GetProperty("error").GetProperty("reason").GetString()=="window_unavailable","A recycled HWND resolved to the old window identity");
        var replacement=Listed(await peer.Call("windows",new {excludedWindows=excluded}),target);
        Require(replacement!=original && replacement.Split('.')[0]==original.Split('.')[0],"A recycled HWND did not get a new identity");
        await peer.Call("focusWindow",new {handle=replacement,pid=Environment.ProcessId,excludedWindows=excluded});
        target.Activate(); await Task.Delay(250);
    }
    static async Task Run(Form target) {
        using var input=new TextBox { Location=new Point(20,20),Width=300 };
        target.Controls.Add(input);
        int right=0, doubled=0, scroll=0, dragged=0, buttonEvents=0;
        target.MouseDown+=(_,_)=>buttonEvents++;
        target.MouseUp+=(_,_)=>buttonEvents++;
        target.MouseUp+=(_,e)=>{if(e.Button==MouseButtons.Right)right++;};
        target.MouseDoubleClick+=(_,e)=>{if(e.Button==MouseButtons.Left)doubled++;};
        target.MouseWheel+=(_,e)=>scroll+=e.Delta;
        target.MouseMove+=(_,e)=>{if(e.Button==MouseButtons.Left)dragged++;};
        using var overlay=new Form {FormBorderStyle=FormBorderStyle.None,StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(target.PointToScreen(new Point(400,200)),new Size(80,60)),BackColor=Color.Magenta,TopMost=true,ShowInTaskbar=false,Opacity=0.99};
        overlay.Show();
        Require(SetWindowDisplayAffinity(overlay.Handle,0x11),"Cannot set native capture exclusion");
        target.Activate();
        await Task.Delay(250);
        using var peer=new Peer();
        var identity=await peer.Call("identity");
        Require(identity.GetProperty("platform").GetString()=="windows","Wrong native platform");
        await peer.Call("acquire");
        using(var competitor=new Peer()) await competitor.Call("acquire",expectedError:"desktop-busy");
        // Keep the original stdin OPEN with no further requests, as when Electron
        // freezes. Native lease expiry must release both input and exclusivity.
        await peer.Call("key",new {key="Shift",down=true});
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)!=0,"lease test holds Shift");
        await Task.Delay(16000);
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)==0,"lease releases held input");
        using(var afterExpiry=new Peer()) { await afterExpiry.Call("acquire"); await afterExpiry.Call("release"); }
        await peer.Call("check",expectedError:"desktop-not-active");
        await peer.Call("acquire");
        var layout=await peer.Call("layout");
        var screen=Screen.FromControl(target);
        var display=layout.EnumerateArray().Single(d=>d.GetProperty("displayId").GetString()==screen.DeviceName).Clone();
        Require(display.GetProperty("width").GetInt32()==screen.Bounds.Width,"Physical display width mismatch");
        Require(display.GetProperty("scaleFactor").GetDouble()>0,"Missing DPI scale");
        var exclusions=new {excludedWindows=new[]{overlay.Handle.ToInt64().ToString()}};
        await peer.Call("validateExclusion",new {excludedWindows=new[]{"0"}},"desktop-unsupported-operation");
        await peer.Call("validateExclusion",exclusions);
        await peer.Call("capture",new {excludedWindows=exclusions.excludedWindows,display=new {displayId="missing"},layout},"desktop-display-unavailable");
        await peer.Call("capture",new {excludedWindows=exclusions.excludedWindows,display,layout=Array.Empty<object>()},"desktop-stale-layout");
        var captures=await peer.Call("capture",new {excludedWindows=exclusions.excludedWindows,display,layout});
        Require(captures.GetArrayLength()==1,"Capture included an unselected display");
        var capture=captures.EnumerateArray().Single(d=>d.GetProperty("displayId").GetString()==screen.DeviceName);
        using(var bytes=new MemoryStream(Convert.FromBase64String(capture.GetProperty("data").GetString()!)))
        using(var bitmap=new Bitmap(bytes)) {
            Require(bitmap.Width==screen.Bounds.Width && bitmap.Height==screen.Bounds.Height,"Capture dimensions mismatch");
            var sample=overlay.PointToScreen(new Point(40,30));
            var pixel=bitmap.GetPixel(sample.X-screen.Bounds.X,sample.Y-screen.Bounds.Y);
            Require(pixel.B>100 && pixel.G>70 && pixel.R<160,"Excluded indicator leaked into native capture");
            Directory.CreateDirectory("native/desktop/tests/windows/artifacts");
            bitmap.Save("native/desktop/tests/windows/artifacts/capture.png");
        }
        await WindowTargets(peer,target,overlay,screen,display,layout,exclusions.excludedWindows);
        async Task Move(Point p) => await peer.Call("move",new {display,layout,x=p.X-screen.Bounds.X,y=p.Y-screen.Bounds.Y});
        async Task Button(string button,bool down) => await peer.Call("button",new {button,down,clickCount=1});
        var point=target.PointToScreen(new Point(200,150));
        await Move(point);
        await Observe(()=>Math.Abs(Cursor.Position.X-point.X)<=1 && Math.Abs(Cursor.Position.Y-point.Y)<=1,"cursor-only screenshot-coordinate movement");
        Require(buttonEvents==0 && right==0 && doubled==0 && dragged==0,"Cursor move synthesized a button event");
        Require((GetAsyncKeyState(1)&0x8000)==0 && (GetAsyncKeyState(2)&0x8000)==0,"Cursor move held a mouse button");
        await peer.Call("move",new {display,layout=Array.Empty<object>(),x=0,y=0},"desktop-stale-layout");
        Require(Math.Abs(Cursor.Position.X-point.X)<=1 && Math.Abs(Cursor.Position.Y-point.Y)<=1,"Rejected move changed the cursor");
        await Button("right",true); await Button("right",false);
        await Observe(()=>right==1,"right click");
        for(int i=0;i<2;i++) { await Button("left",true); await Button("left",false); }
        await Observe(()=>doubled>0,"double click");
        input.Focus(); await peer.Call("text",new {text="é"});
        await Observe(()=>input.Text=="é","Unicode text");
        await peer.Call("key",new {key="Control",down=true});
        await peer.Call("key",new {key="a",down=true}); await peer.Call("key",new {key="a",down=false});
        await peer.Call("key",new {key="Control",down=false});
        await peer.Call("text",new {text="Z"}); await Observe(()=>input.Text=="Z","Control+A chord");
        target.ActiveControl=null; target.Focus(); await Move(point);
        await peer.Call("scroll",new {deltaX=0,deltaY=48}); await Observe(()=>scroll!=0,"scroll wheel");
        await Button("left",true); await Move(new Point(point.X+50,point.Y+50));
        await Observe(()=>dragged>0,"drag continuation");
        await peer.Call("releaseInput");
        await Observe(()=>(GetAsyncKeyState(1)&0x8000)==0,"cancelled button release");
        await peer.Call("release");
        Require(Identity(target)==0,"Release must remove window identity tags");
        await peer.Call("acquire");
        await peer.Call("key",new {key="Shift",down=true});
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)!=0,"held Shift");
        await peer.End();
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)==0,"EOF releases held Shift");
        using var successor=new Peer(); await successor.Call("acquire"); await successor.Call("release");
        // Lock-free: still answers after release (session-end app-switch check).
        target.Activate(); await Task.Delay(250);
        var front=await successor.Call("frontmost");
        Require(front.GetProperty("pid").GetInt32()==Environment.ProcessId && front.EnumerateObject().Count()==1,"frontmost must report only the foreground pid");
        await successor.Call("check",expectedError:"desktop-not-active");
    }
}
