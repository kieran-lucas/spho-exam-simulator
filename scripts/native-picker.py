"""Test helper: choose a ZIP in this application's Windows file picker using Win32 messages."""
import ctypes
from ctypes import wintypes
import sys, time

user = ctypes.WinDLL('user32', use_last_error=True)
user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.SendMessageW.restype = wintypes.LPARAM
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.IsWindow.argtypes = [wintypes.HWND]
user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
user.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
user.GetDlgCtrlID.argtypes = [wintypes.HWND]
user.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
user.GetDlgItem.restype = wintypes.HWND
pid = int(sys.argv[1]); path = sys.argv[2]
if path in ('--close','--minimize','--restore'):
    windows=[]
    @callback_type
    def find_main(hwnd, _):
        owner=wintypes.DWORD(); user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        title=ctypes.create_unicode_buffer(512); user.GetWindowTextW(hwnd,title,512)
        if owner.value==pid and title.value=='SPhO Exam Simulator': windows.append(hwnd)
        return True
    user.EnumWindows(find_main,0)
    if not windows: raise SystemExit('Native application window not found')
    if path=='--close': user.PostMessageW(windows[0],0x0010,0,0)  # WM_CLOSE follows the real native lifecycle.
    else: user.ShowWindow(windows[0],6 if path=='--minimize' else 9)
    sys.exit(0)
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    matches=[]
    @callback_type
    def find_dialog(hwnd, _):
        owner=wintypes.DWORD(); user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        cls=ctypes.create_unicode_buffer(256); user.GetClassNameW(hwnd, cls, 256)
        if owner.value==pid and cls.value=='#32770': matches.append(hwnd)
        return True
    user.EnumWindows(find_dialog, 0)
    if matches:
        dialog=matches[0]; edits=[]
        @callback_type
        def find_edit(hwnd, _):
            cls=ctypes.create_unicode_buffer(256); user.GetClassNameW(hwnd,cls,256)
            if cls.value=='Edit': edits.append((hwnd,user.GetDlgCtrlID(hwnd)))
            return True
        user.EnumChildWindows(dialog,find_edit,0)
        # File name edit has control ID 1148 (or resides in ComboBoxEx ID 1148).
        target=next((h for h,c in edits if c==1148), edits[-1][0] if edits else None)
        if target:
            text=ctypes.create_unicode_buffer(path)
            user.SendMessageW(target,0x000C,0,ctypes.cast(text,ctypes.c_void_p).value)  # WM_SETTEXT
            button=user.GetDlgItem(dialog,1)
            if button: user.PostMessageW(button,0x00F5,0,0)  # BM_CLICK invokes IFileDialog's Open button.
            else: user.PostMessageW(dialog,0x0111,1,0)
            for _ in range(30):
                if not user.IsWindow(dialog):
                    print('Selected native ZIP:',path)
                    sys.exit(0)
                time.sleep(.1)
    time.sleep(.15)
raise SystemExit('Native file dialog could not be automated')
