//! Shared navigation cancellation and a total wall-clock budget.
use std::{
    io,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
#[derive(Clone)]
pub struct Control {
    generation: Arc<AtomicU64>,
    expected: u64,
    deadline: Instant,
}
impl Control {
    pub fn new(generation: Arc<AtomicU64>, expected: u64) -> Self {
        Self {
            generation,
            expected,
            deadline: Instant::now() + Duration::from_secs(30),
        }
    }
    pub fn remaining(&self) -> io::Result<Duration> {
        self.check()?;
        Ok(self
            .deadline
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1)))
    }
    pub fn check(&self) -> io::Result<()> {
        if self.generation.load(Ordering::Relaxed) != self.expected {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "navigation cancelled",
            ));
        }
        if Instant::now() >= self.deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "navigation exceeded 30 seconds",
            ));
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn superseded_navigation_is_cancelled() {
        let generation = Arc::new(AtomicU64::new(1));
        let control = Control::new(generation.clone(), 1);
        assert!(control.check().is_ok());
        generation.store(2, Ordering::Relaxed);
        assert_eq!(
            control.check().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
    }
    #[test]
    fn expired_navigation_times_out() {
        let control = Control {
            generation: Arc::new(AtomicU64::new(1)),
            expected: 1,
            deadline: Instant::now() - Duration::from_secs(1),
        };
        assert_eq!(control.check().unwrap_err().kind(), io::ErrorKind::TimedOut);
    }
}
