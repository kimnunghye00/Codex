use std::io;
use std::process::Child;

const RENDERER_MEMORY_LIMIT_BYTES: usize = 192 * 1024 * 1024;
const RENDERER_CPU_TIME_100NS: i64 = 10 * 10_000_000;

#[cfg(windows)]
pub struct SandboxGuard {
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(not(windows))]
pub struct SandboxGuard;

#[cfg(windows)]
pub fn confine_renderer(child: &Child) -> io::Result<SandboxGuard> {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_PROCESS_TIME, JOB_OBJECT_UILIMIT_DESKTOP,
        JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
        JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES,
        JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
        JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    };

    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }

        let fail = |job: HANDLE| {
            let error = io::Error::last_os_error();
            CloseHandle(job);
            error
        };

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
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            return Err(fail(job));
        }

        let process_handle = child.as_raw_handle() as HANDLE;
        if AssignProcessToJobObject(job, process_handle) == 0 {
            return Err(fail(job));
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
            job,
            JobObjectBasicUIRestrictions,
            &ui as *const _ as *const c_void,
            size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
        ) == 0
        {
            return Err(fail(job));
        }

        Ok(SandboxGuard { job })
    }
}

#[cfg(not(windows))]
pub fn confine_renderer(_child: &Child) -> io::Result<SandboxGuard> {
    eprintln!(
        "[browser-core] warning: OS Job Object containment is only enforced on Windows"
    );
    Ok(SandboxGuard)
}

#[cfg(windows)]
impl Drop for SandboxGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}
