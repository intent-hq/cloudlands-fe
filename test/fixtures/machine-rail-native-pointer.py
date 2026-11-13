"""X11/XTest input, deliberately outside Electron/CDP's event injection path."""
import ctypes as c
import ctypes.util
import sys

try:
    x11 = c.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
    xtst = c.CDLL(ctypes.util.find_library('Xtst') or 'libXtst.so.6')
except OSError as error:
    sys.stderr.write(f'Native pointer needs X11 and XTest: {error}\n')
    sys.exit(77)

x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XCloseDisplay.argtypes = [c.c_void_p]
x11.XSync.argtypes = [c.c_void_p, c.c_int]
xtst.XTestQueryExtension.argtypes = [c.c_void_p] + [c.POINTER(c.c_int)] * 4
xtst.XTestFakeMotionEvent.argtypes = [c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
display = x11.XOpenDisplay(None)
if not display:
    sys.stderr.write('Native pointer needs an accessible X11 DISPLAY.\n')
    sys.exit(77)
try:
    values = [c.c_int() for _ in range(4)]
    if not xtst.XTestQueryExtension(display, *[c.byref(v) for v in values]):
        sys.stderr.write('Native pointer needs the XTest extension.\n')
        sys.exit(77)
    command = sys.argv[1]
    if command != 'probe':
        x, y = map(int, sys.argv[2:4])
        if not xtst.XTestFakeMotionEvent(display, -1, x, y, 0):
            raise RuntimeError('XTest motion failed')
        if command in ('down', 'up'):
            if not xtst.XTestFakeButtonEvent(display, 1, command == 'down', 0):
                raise RuntimeError('XTest button failed')
        elif command != 'move':
            raise ValueError(command)
    x11.XSync(display, False)
finally:
    x11.XCloseDisplay(display)
