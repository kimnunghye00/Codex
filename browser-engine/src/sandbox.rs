use std::io::{self, Read, Write};
use std::path::Path;

#[cfg(windows)]
use std::fs::File;

const RENDERER_MEMORY_LIMIT_BYTES: usize = 192 * 1024 * 1024;
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
    job: windows_sys::Win32::Foundation::HANDLE,
    waited: bool,
}

#[cfg(windows)]
impl RendererProcess {
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
            SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
            SECURITY_MAX_SID_SIZE, TokenIntegrityLevel, WinLowLabelSid,
        };
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicUIRestrictions, SetInformationJobObject,
            JOBOBJECT_BASIC_UI_RESTRICTIONS, JOB_OBJECT_UILIMIT_DESKTOP,
            JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
            JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES,
            JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
            JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
        };
        use windows_sys::Win32::System::SystemServices::SE_GROUP_INTEGRITY;
            use windows_sys::Win32::System::Threading::OpenProcessToken;

        unsafe {
            let mut token: HANDLE = null_mut();
            if OpenProcessToken(
                self.process,
                TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
                &mut token,
            ) == 0
            {
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

                if CreateWellKnownSid(
                    WinLowLabelSid,
                    null_mut(),
                    low_sid,
                    &mut low_sid_size,
                ) == 0
                {
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
                    UIRestrictionsClass:
                        JOB_OBJECT_UILIMIT_HANDLES
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
        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;

            // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE makes this fail closed:
            // dropping the browser-side guard terminates a still-running renderer.
            if !self.job.is_null() {
                CloseHandle(self.job);
                self.job = std::ptr::null_mut();
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
    use windows_sys::Win32::Security::{
        CreateRestrictedToken, GetTokenInformation, IsTokenRestricted, SID_AND_ATTRIBUTES,
        TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY, TOKEN_USER,
        DISABLE_MAX_PRIVILEGE, TokenUser, WRITE_RESTRICTED,
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
        CreateProcessAsUserW, GetCurrentProcess, OpenProcessToken, ResumeThread,
        CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
        STARTUPINFOW,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    struct Handles {
        stdin_read: HANDLE,
        stdin_write: HANDLE,
        stdout_read: HANDLE,
        stdout_write: HANDLE,
        stderr_handle: HANDLE,
        source_token: HANDLE,
        restricted_token: HANDLE,
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
            if SetHandleInformation(
                handles.stdin_write,
                HANDLE_FLAG_INHERIT,
                0,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }

            if SetHandleInformation(
                handles.stdout_read,
                HANDLE_FLAG_INHERIT,
                0,
            ) == 0
            {
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

            let mut user_buffer = vec![0u8; user_bytes_needed as usize];
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
            let restricting_sid = SID_AND_ATTRIBUTES {
                Sid: token_user.User.Sid,
                Attributes: 0,
            };

            if CreateRestrictedToken(
                handles.source_token,
                DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
                0,
                null(),
                0,
                null(),
                1,
                &restricting_sid,
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
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
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

            // The renderer was created suspended. Restricted Token and resource/process
            // Job limits exist before its first instruction. The trusted worker sends READY
            // after runtime initialization. Only then does the broker add Low Integrity
            // plus UI restrictions, before sending any untrusted HTML.
            if ResumeThread(handles.thread) == u32::MAX {
                return Err(io::Error::last_os_error());
            }

            CloseHandle(handles.thread);
            handles.thread = null_mut();

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
            let job = handles.job;
            handles.job = null_mut();

            Ok(RendererProcess {
                stdin: Some(RendererInput(stdin_file)),
                stdout: Some(RendererOutput(stdout_file)),
                process,
                job,
                waited: false,
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
    child: std::process::Child,
    stdin: Option<RendererInput>,
    stdout: Option<RendererOutput>,
}

#[cfg(not(windows))]
impl RendererProcess {
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
        let _ = self.child.kill();
    }

    pub fn activate_content_restrictions(&mut self) -> io::Result<()> {
        Ok(())
    }

    pub fn wait_success(&mut self) -> io::Result<()> {
        let status = self.child.wait()?;
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

    let stdin = child
        .stdin
        .take()
        .map(RendererInput)
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .map(RendererOutput)
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "renderer stdout unavailable"))?;

    Ok(RendererProcess {
        child,
        stdin: Some(stdin),
        stdout: Some(stdout),
    })
}
