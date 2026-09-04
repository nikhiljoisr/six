//! Persistence: SQLite through sqlx. The pool is created by `tauri-plugin-sql` (which
//! also runs the numbered migrations in `migrations/`); this module only reads and
//! writes rows. The frontend has no SQL permissions, so every write goes through the
//! domain first.

pub mod rows;
pub mod store;

pub use store::*;

pub type Pool = sqlx::SqlitePool;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("corrupt row: {0}")]
    Corrupt(String),
}

pub type DbResult<T> = Result<T, DbError>;

/// The migrations embedded at compile time, for tests. The app hands the same files to
/// the plugin (see `migrations()`), which records them in the same `_sqlx_migrations` table.
#[cfg(test)]
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The migrations in the form `tauri-plugin-sql` expects.
pub fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "init",
            sql: include_str!("../../migrations/0001_init.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "pomodoro",
            sql: include_str!("../../migrations/0002_pomodoro.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "public",
            sql: include_str!("../../migrations/0003_public.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "idle_gap",
            sql: include_str!("../../migrations/0004_idle_gap.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ]
}

/// The database URL the plugin preloads (see `tauri.conf.json` → plugins.sql.preload).
pub const DB_URL: &str = "sqlite:six.db";

/// A fresh in-memory database with migrations applied.
#[cfg(test)]
pub async fn open_in_memory() -> DbResult<Pool> {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?.foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

/// The SQLite pool that `tauri-plugin-sql` opened for `DB_URL` during its setup.
pub fn pool_from_plugin<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> DbResult<Pool> {
    use tauri::Manager;
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let guard = tauri::async_runtime::block_on(instances.0.read());
    match guard.get(DB_URL) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Ok(pool.clone()),
        #[allow(unreachable_patterns)]
        Some(_) => Err(DbError::Corrupt(format!("{DB_URL} is not a SQLite pool"))),
        None => Err(DbError::Corrupt(format!(
            "{DB_URL} was not preloaded by tauri-plugin-sql"
        ))),
    }
}
