//! A copy of the database for each of the last few days Six was opened. Local, automatic,
//! and never in the way: a failure here is logged and nothing else notices.

use std::path::{Path, PathBuf};

use chrono::NaiveDate;

use super::Pool;

/// How many daily copies are kept.
pub const KEEP: usize = 7;

/// "six-2026-10-03.db": one copy per calendar day, named so they sort by date.
pub fn file_name(date: NaiveDate) -> String {
    format!("six-{}.db", date.format("%Y-%m-%d"))
}

/// Whether a file name is one of ours, so nothing else in the folder is ever removed.
fn is_backup(name: &str) -> bool {
    name.strip_prefix("six-")
        .and_then(|rest| rest.strip_suffix(".db"))
        .is_some_and(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
}

/// The copies to remove so that only the newest `keep` remain. Other files are left alone.
pub fn to_prune(names: &[String], keep: usize) -> Vec<String> {
    let mut ours: Vec<&String> = names.iter().filter(|n| is_backup(n)).collect();
    ours.sort();
    let extra = ours.len().saturating_sub(keep);
    ours.into_iter().take(extra).cloned().collect()
}

/// Make today's copy if there is none yet, then prune. Returns the new file, if one was
/// written. `VACUUM INTO` writes a consistent copy even while the database is in use.
pub async fn run(pool: &Pool, dir: &Path, today: NaiveDate) -> Result<Option<PathBuf>, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let target = dir.join(file_name(today));
    let mut written = None;
    if !target.exists() {
        let path = target
            .to_str()
            .ok_or_else(|| format!("{} is not a usable path", target.display()))?;
        if let Err(e) = sqlx::query("VACUUM INTO ?").bind(path).execute(pool).await {
            let _ = std::fs::remove_file(&target);
            return Err(format!("could not write {}: {e}", target.display()));
        }
        written = Some(target);
    }
    let names: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| format!("could not read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .collect();
    for name in to_prune(&names, KEEP) {
        let _ = std::fs::remove_file(dir.join(name));
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(days: &[u32]) -> Vec<String> {
        days.iter()
            .map(|d| file_name(NaiveDate::from_ymd_opt(2026, 10, *d).unwrap()))
            .collect()
    }

    #[test]
    fn only_the_oldest_copies_beyond_the_limit_are_pruned() {
        assert!(to_prune(&names(&[1, 2, 3]), 7).is_empty());
        let nine = names(&[9, 1, 5, 2, 8, 3, 7, 4, 6]);
        assert_eq!(to_prune(&nine, 7), names(&[1, 2]));
        assert_eq!(to_prune(&nine, 0).len(), 9);
    }

    #[test]
    fn files_that_are_not_backups_are_never_touched() {
        let mut mixed = names(&[1, 2, 3]);
        mixed.extend(["six.db", "six-notes.db", "six-2026-13-40.db", "notes.txt", ".DS_Store"].map(String::from));
        assert_eq!(to_prune(&mixed, 1), names(&[1, 2]));
    }

    #[tokio::test]
    async fn a_copy_is_written_once_a_day_and_holds_the_data() {
        let dir = std::env::temp_dir().join(format!("six-backup-test-{}", crate::domain::plan::new_id()));
        // A file-backed database: VACUUM INTO needs a real one to copy.
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.db");
        let url = format!("sqlite:{}?mode=rwc", source.display());
        let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
        crate::db::MIGRATOR.run(&pool).await.unwrap();
        let backups = dir.join("backups");
        let today = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();

        let first = run(&pool, &backups, today).await.unwrap();
        assert_eq!(first, Some(backups.join("six-2026-10-03.db")));
        assert_eq!(run(&pool, &backups, today).await.unwrap(), None, "one copy a day");

        let copy = sqlx::SqlitePool::connect(&format!("sqlite:{}", backups.join("six-2026-10-03.db").display()))
            .await
            .unwrap();
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings").fetch_one(&copy).await.unwrap();
        assert!(rows > 0, "the copy is a readable database with the settings in it");
        copy.close().await;
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
