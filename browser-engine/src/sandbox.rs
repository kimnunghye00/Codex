use std::io::{self, Read, Write};
use std::path::Path;

#[cfg(windows)]
use std::fs::File;

#[cfg(windows)]
const RENDERER_MEMORY_LIMIT_BYTES: usize = 192 * 1024 * 1024;
#[cfg(windows)]
const RENDERER_CPU_TIME_100NS: i64 = 10 * 10_000_000;

#[cfg(windows)]
pub struct RendererInput(File);

#[cfg(windows)]
impl Write for RendererInput {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

#[cfg(windows)]
pub struct RendererOutput(File);

#[cfg(windows)]
impl Read for RendererOutput {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

#[cfg(windows)]
pub struct RendererProcess {
    stdin: Option<RendererInput>,
    stdout: Option<RendererOutput>,
    process: windows_sys::Win32::Foundation::HANDLE,
    thread: windows_sys::Win32::Foundation::HANDLE,
    job: windows_sys::Win32::Foundation::HANDLE,
    waited: bool,
    watchdog: Option<Watchdog>,
}

#[cfg(windows)]
impl RendererProcess {
    pub fn start_watchdog(
        &mut self,
        control: Option<crate::navigation::Control>,
    ) -> io::Result<()> {
        use windows_sys::Win32::{
            Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS},
            System::Threading::{GetCurrentProcess, TerminateProcess},
        };
        let mut duplicate = std::ptr::null_mut();
        if unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                self.process,
                GetCurrentProcess(),
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let handle = duplicate as usize;
        self.watchdog = Some(Watchdog::start(
            control,
            move || unsafe {
                TerminateProcess(handle as _, 1);
            },
            move || unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle as _);
            },
        ));
        Ok(())
    }

    pub fn take_stdin(&mut self) -> io::Result<RendererInput> {
        self.stdin
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdin unavailable"))
    }

    pub fn take_stdout(&mut self) -> io::Result<RendererOutput> {
        self.stdout
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdout unavailable"))
    }

    pub fn kill(&mut self) {
        if !self.process.is_null() {
            unsafe {
                windows_sys::Win32::System::Threading::TerminateProcess(self.process, 1);
            }
        }
    }

    pub fn activate_content_restrictions(&mut self) -> io::Result<()> {
        use std::ffi::c_void;
        use std::mem::size_of;
        use std::ptr::null_mut;

        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{
            CreateWellKnownSid, GetLengthSid, IsTokenRestricted, SetTokenInformation,
            TokenIntegrityLevel, WinLowLabelSid, SECURITY_MAX_SID_SIZE, SID_AND_ATTRIBUTES,
            TOKEN_ADJUST_DEFAULT, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicUIRestrictions, SetInformationJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS,
            JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS,
            JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS,
            JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD,
            JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
        };
        use windows_sys::Win32::System::SystemServices::SE_GROUP_INTEGRITY;
        use windows_sys::Win32::System::Threading::{OpenProcessToken, OpenThreadToken};

        unsafe {
            // READY is accepted only after the initial thread discarded its
            // loader-only impersonation token. Verify this in the broker too.
            let mut bootstrap: HANDLE = null_mut();
            if OpenThreadToken(self.thread, TOKEN_QUERY, 1, &mut bootstrap) != 0 {
                CloseHandle(bootstrap);
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "renderer retained its bootstrap token",
                ));
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(windows_sys::Win32::Foundation::ERROR_NO_TOKEN as i32) {
                return Err(error);
            }
            let mut token: HANDLE = null_mut();
            if OpenProcessToken(self.process, TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }

            let result = (|| -> io::Result<()> {
                if IsTokenRestricted(token) == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "running renderer token is not restricted",
                    ));
                }

                let mut low_sid_storage = [0u8; SECURITY_MAX_SID_SIZE as usize];
                let mut low_sid_size = low_sid_storage.len() as u32;
                let low_sid = low_sid_storage.as_mut_ptr() as *mut c_void;

                if CreateWellKnownSid(WinLowLabelSid, null_mut(), low_sid, &mut low_sid_size) == 0 {
                    return Err(io::Error::last_os_error());
                }

                let label = TOKEN_MANDATORY_LABEL {
                    Label: SID_AND_ATTRIBUTES {
                        Sid: low_sid,
                        Attributes: SE_GROUP_INTEGRITY as u32,
                    },
                };

                let label_size = size_of::<TOKEN_MANDATORY_LABEL>()
                    .saturating_add(GetLengthSid(low_sid) as usize);

                if SetTokenInformation(
                    token,
                    TokenIntegrityLevel,
                    &label as *const _ as *mut c_void,
                    label_size as u32,
                ) == 0
                {
                    return Err(io::Error::last_os_error());
                }

                let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
                    UIRestrictionsClass: JOB_OBJECT_UILIMIT_HANDLES
                        | JOB_OBJECT_UILIMIT_READCLIPBOARD
                        | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
                        | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                        | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                        | JOB_OBJECT_UILIMIT_GLOBALATOMS
                        | JOB_OBJECT_UILIMIT_DESKTOP
                        | JOB_OBJECT_UILIMIT_EXITWINDOWS,
                };

                if SetInformationJobObject(
                    self.job,
                    JobObjectBasicUIRestrictions,
                    &ui as *const _ as *const c_void,
                    size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
                ) == 0
                {
                    return Err(io::Error::last_os_error());
                }

                Ok(())
            })();

            CloseHandle(token);
            result
        }
    }

    pub fn wait_success(&mut self) -> io::Result<()> {
        use windows_sys::Win32::Foundation::WAIT_FAILED;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, WaitForSingleObject, INFINITE,
        };

        let result = unsafe { WaitForSingleObject(self.process, INFINITE) };
        if result == WAIT_FAILED {
            return Err(io::Error::last_os_error());
        }

        let mut code = 0u32;
        if unsafe { GetExitCodeProcess(self.process, &mut code) } == 0 {
            return Err(io::Error::last_os_error());
        }

        self.waited = true;

        if code == 0 {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("renderer exited with code {code}"),
            ))
        }
    }
}

#[cfg(windows)]
impl Drop for RendererProcess {
    fn drop(&mut self) {
        self.watchdog.take();
        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;

            // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE makes this fail closed:
            // dropping the browser-side guard terminates a still-running renderer.
            if !self.job.is_null() {
                CloseHandle(self.job);
                self.job = std::ptr::null_mut();
            }

            if !self.thread.is_null() {
                CloseHandle(self.thread);
                self.thread = std::ptr::null_mut();
            }
            if !self.process.is_null() {
                CloseHandle(self.process);
                self.process = std::ptr::null_mut();
            }
        }
    }
}

#[cfg(windows)]
pub fn spawn_renderer(executable: &Path) -> io::Result<RendererProcess> {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{
        CloseHandle, SetHandleInformation, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT,
        INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::Security::{
        CreateRestrictedToken, DuplicateTokenEx, GetTokenInformation, IsTokenRestricted,
        SecurityImpersonation, TokenGroups, TokenImpersonation, TokenUser, DISABLE_MAX_PRIVILEGE,
        SID_AND_ATTRIBUTES, TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_GROUPS, TOKEN_IMPERSONATE,
        TOKEN_QUERY, TOKEN_USER, WRITE_RESTRICTED,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_PROCESS_TIME,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CreateProcessAsUserW, GetCurrentProcess, OpenProcessToken, ResumeThread, SetThreadToken,
        CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
        STARTUPINFOW,
    };

    struct Handles {
        stdin_read: HANDLE,
        stdin_write: HANDLE,
        stdout_read: HANDLE,
        stdout_write: HANDLE,
        stderr_handle: HANDLE,
        source_token: HANDLE,
        restricted_token: HANDLE,
        bootstrap_token: HANDLE,
        bootstrap_primary: HANDLE,
        process: HANDLE,
        thread: HANDLE,
        job: HANDLE,
    }

    impl Handles {
        fn new() -> Self {
            Self {
                stdin_read: null_mut(),
                stdin_write: null_mut(),
                stdout_read: null_mut(),
                stdout_write: null_mut(),
                stderr_handle: null_mut(),
                source_token: null_mut(),
                restricted_token: null_mut(),
                bootstrap_token: null_mut(),
                bootstrap_primary: null_mut(),
                process: null_mut(),
                thread: null_mut(),
                job: null_mut(),
            }
        }

        unsafe fn close_all(&mut self) {
            for handle in [
                &mut self.stdin_read,
                &mut self.stdin_write,
                &mut self.stdout_read,
                &mut self.stdout_write,
                &mut self.stderr_handle,
                &mut self.source_token,
                &mut self.restricted_token,
                &mut self.bootstrap_token,
                &mut self.bootstrap_primary,
                &mut self.thread,
                &mut self.process,
                &mut self.job,
            ] {
                if !(*handle).is_null() && *handle != INVALID_HANDLE_VALUE {
                    CloseHandle(*handle);
                    *handle = null_mut();
                }
            }
        }
    }

    let mut handles = Handles::new();

    unsafe {
        let result = (|| -> io::Result<RendererProcess> {
            let mut inherit = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            };

            if CreatePipe(
                &mut handles.stdin_read,
                &mut handles.stdin_write,
                &mut inherit,
                0,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            if CreatePipe(
                &mut handles.stdout_read,
                &mut handles.stdout_write,
                &mut inherit,
                0,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            // Parent-side ends must never be inherited by the renderer.
            if SetHandleInformation(handles.stdin_write, HANDLE_FLAG_INHERIT, 0) == 0 {
                return Err(io::Error::last_os_error());
            }

            if SetHandleInformation(handles.stdout_read, HANDLE_FLAG_INHERIT, 0) == 0 {
                return Err(io::Error::last_os_error());
            }

            let nul: Vec<u16> = "NUL\0".encode_utf16().collect();
            handles.stderr_handle = CreateFileW(
                nul.as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &inherit,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                null_mut(),
            );

            if handles.stderr_handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }

            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY,
                &mut handles.source_token,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            let mut user_bytes_needed = 0u32;
            GetTokenInformation(
                handles.source_token,
                TokenUser,
                null_mut(),
                0,
                &mut user_bytes_needed,
            );

            if user_bytes_needed == 0 {
                return Err(io::Error::last_os_error());
            }

            let mut user_buffer =
                vec![0usize; (user_bytes_needed as usize).div_ceil(size_of::<usize>())];
            if GetTokenInformation(
                handles.source_token,
                TokenUser,
                user_buffer.as_mut_ptr() as *mut c_void,
                user_bytes_needed,
                &mut user_bytes_needed,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            let token_user = &*(user_buffer.as_ptr() as *const TOKEN_USER);
            let user_sid = SID_AND_ATTRIBUTES {
                Sid: token_user.User.Sid,
                Attributes: 0,
            };

            // Runtime DLL initialization may need the inherited desktop's logon SID.
            // Keep it in the write-restricting list together with the user SID; this
            // does not grant any access absent from the original token. Untrusted
            // input remains blocked until Low Integrity and Job UI limits are set.
            let mut groups_size = 0;
            GetTokenInformation(
                handles.source_token,
                TokenGroups,
                null_mut(),
                0,
                &mut groups_size,
            );
            if groups_size == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut groups_buffer =
                vec![0usize; (groups_size as usize).div_ceil(size_of::<usize>())];
            if GetTokenInformation(
                handles.source_token,
                TokenGroups,
                groups_buffer.as_mut_ptr() as *mut c_void,
                groups_size,
                &mut groups_size,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let groups = &*(groups_buffer.as_ptr() as *const TOKEN_GROUPS);
            let entries =
                std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize);
            let mut restricting_sids = vec![user_sid];
            let logon_mask = windows_sys::Win32::System::SystemServices::SE_GROUP_LOGON_ID as u32;
            for group in entries {
                if group.Attributes & logon_mask == logon_mask {
                    restricting_sids.push(SID_AND_ATTRIBUTES {
                        Sid: group.Sid,
                        Attributes: 0,
                    });
                }
            }

            if CreateRestrictedToken(
                handles.source_token,
                DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
                0,
                null(),
                0,
                null(),
                restricting_sids.len() as u32,
                restricting_sids.as_ptr(),
                &mut handles.restricted_token,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            if IsTokenRestricted(handles.restricted_token) == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "renderer token was not reported as restricted",
                ));
            }

            let mut startup: STARTUPINFOW = zeroed();
            startup.cb = size_of::<STARTUPINFOW>() as u32;
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = handles.stdin_read;
            startup.hStdOutput = handles.stdout_write;
            startup.hStdError = handles.stderr_handle;

            let mut process_info: PROCESS_INFORMATION = zeroed();
            let application: Vec<u16> = executable
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            if CreateProcessAsUserW(
                handles.restricted_token,
                application.as_ptr(),
                null_mut(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                null(),
                null(),
                &startup,
                &mut process_info,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            handles.process = process_info.hProcess;
            handles.thread = process_info.hThread;

            handles.job = CreateJobObjectW(null(), null());
            if handles.job.is_null() {
                return Err(io::Error::last_os_error());
            }

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                | JOB_OBJECT_LIMIT_PROCESS_MEMORY
                | JOB_OBJECT_LIMIT_PROCESS_TIME
                | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            limits.BasicLimitInformation.PerProcessUserTimeLimit = RENDERER_CPU_TIME_100NS;
            limits.ProcessMemoryLimit = RENDERER_MEMORY_LIMIT_BYTES;

            if SetInformationJobObject(
                handles.job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            if AssignProcessToJobObject(handles.job, handles.process) == 0 {
                return Err(io::Error::last_os_error());
            }

            // The primary token and Job are restricted from creation. Only the
            // initial thread gets a loader/CRT bootstrap impersonation token.
            // The worker discards it before READY; the broker verifies that
            // removal before lowering integrity and sending document bytes.
            // Both tokens derive directly from the same source token. A plain
            // unrestricted impersonation token is not a restricted-token sibling:
            // Windows can downgrade it to Identification and the loader then fails.
            // Include the original enabled SIDs to retain ordinary ACL access only
            // for trusted startup, while removing unnecessary privileges.
            let mut initial_sids = vec![user_sid];
            let enabled = windows_sys::Win32::System::SystemServices::SE_GROUP_ENABLED as u32;
            let deny_only =
                windows_sys::Win32::System::SystemServices::SE_GROUP_USE_FOR_DENY_ONLY as u32;
            for group in entries {
                if group.Attributes & enabled != 0 && group.Attributes & deny_only == 0 {
                    initial_sids.push(SID_AND_ATTRIBUTES {
                        Sid: group.Sid,
                        Attributes: 0,
                    });
                }
            }
            if CreateRestrictedToken(
                handles.source_token,
                DISABLE_MAX_PRIVILEGE,
                0,
                null(),
                0,
                null(),
                initial_sids.len() as u32,
                initial_sids.as_ptr(),
                &mut handles.bootstrap_primary,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            if DuplicateTokenEx(
                handles.bootstrap_primary,
                TOKEN_IMPERSONATE | TOKEN_QUERY,
                null(),
                SecurityImpersonation,
                TokenImpersonation,
                &mut handles.bootstrap_token,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            CloseHandle(handles.bootstrap_primary);
            handles.bootstrap_primary = null_mut();
            if SetThreadToken(&handles.thread, handles.bootstrap_token) == 0 {
                return Err(io::Error::last_os_error());
            }
            CloseHandle(handles.bootstrap_token);
            handles.bootstrap_token = null_mut();
            if ResumeThread(handles.thread) == u32::MAX {
                return Err(io::Error::last_os_error());
            }

            CloseHandle(handles.stdin_read);
            handles.stdin_read = null_mut();
            CloseHandle(handles.stdout_write);
            handles.stdout_write = null_mut();
            CloseHandle(handles.stderr_handle);
            handles.stderr_handle = null_mut();

            CloseHandle(handles.source_token);
            handles.source_token = null_mut();
            CloseHandle(handles.restricted_token);
            handles.restricted_token = null_mut();

            let stdin_file = File::from_raw_handle(handles.stdin_write as RawHandle);
            handles.stdin_write = null_mut();

            let stdout_file = File::from_raw_handle(handles.stdout_read as RawHandle);
            handles.stdout_read = null_mut();

            let process = handles.process;
            handles.process = null_mut();
            let thread = handles.thread;
            handles.thread = null_mut();
            let job = handles.job;
            handles.job = null_mut();

            Ok(RendererProcess {
                stdin: Some(RendererInput(stdin_file)),
                stdout: Some(RendererOutput(stdout_file)),
                process,
                thread,
                job,
                waited: false,
                watchdog: None,
            })
        })();

        if result.is_err() {
            if !handles.process.is_null() {
                windows_sys::Win32::System::Threading::TerminateProcess(handles.process, 1);
            }
            handles.close_all();
        }

        result
    }
}

#[cfg(not(windows))]
pub struct RendererInput(std::process::ChildStdin);

#[cfg(not(windows))]
impl Write for RendererInput {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

#[cfg(not(windows))]
pub struct RendererOutput(std::process::ChildStdout);

#[cfg(not(windows))]
impl Read for RendererOutput {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

#[cfg(not(windows))]
pub struct RendererProcess {
    child: std::sync::Arc<std::sync::Mutex<std::process::Child>>,
    watchdog: Option<Watchdog>,
    stdin: Option<RendererInput>,
    stdout: Option<RendererOutput>,
}

#[cfg(not(windows))]
impl RendererProcess {
    pub fn start_watchdog(
        &mut self,
        control: Option<crate::navigation::Control>,
    ) -> io::Result<()> {
        let child = self.child.clone();
        self.watchdog = Some(Watchdog::start(
            control,
            move || {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                }
            },
            || {},
        ));
        Ok(())
    }

    pub fn take_stdin(&mut self) -> io::Result<RendererInput> {
        self.stdin
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdin unavailable"))
    }

    pub fn take_stdout(&mut self) -> io::Result<RendererOutput> {
        self.stdout
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdout unavailable"))
    }

    pub fn kill(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }

    pub fn activate_content_restrictions(&mut self) -> io::Result<()> {
        Ok(())
    }

    pub fn wait_success(&mut self) -> io::Result<()> {
        let status = loop {
            if let Some(status) = self
                .child
                .lock()
                .map_err(|_| io::Error::other("renderer lock poisoned"))?
                .try_wait()?
            {
                break status;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("renderer exited with {status}"),
            ))
        }
    }
}

#[cfg(not(windows))]
pub fn spawn_renderer(executable: &Path) -> io::Result<RendererProcess> {
    use std::process::{Command, Stdio};

    eprintln!(
        "[browser-core] warning: Restricted Token / Low Integrity sandboxing is Windows-only"
    );

    let mut child = Command::new(executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let stdin =
        child.stdin.take().map(RendererInput).ok_or_else(|| {
            io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdin unavailable")
        })?;
    let stdout =
        child.stdout.take().map(RendererOutput).ok_or_else(|| {
            io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdout unavailable")
        })?;

    Ok(RendererProcess {
        child: std::sync::Arc::new(std::sync::Mutex::new(child)),
        watchdog: None,
        stdin: Some(stdin),
        stdout: Some(stdout),
    })
}

struct Watchdog {
    stop: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Watchdog {
    fn start(
        control: Option<crate::navigation::Control>,
        kill: impl FnOnce() + Send + 'static,
        cleanup: impl FnOnce() + Send + 'static,
    ) -> Self {
        let (stop, rx) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            loop {
                match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => (),
                }
                if std::time::Instant::now() >= deadline
                    || control.as_ref().is_some_and(|c| c.check().is_err())
                {
                    kill();
                    break;
                }
            }
            cleanup();
        });
        Self {
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}
impl Drop for Watchdog {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
#[cfg(not(windows))]
impl Drop for RendererProcess {
    fn drop(&mut self) {
        self.watchdog.take();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
