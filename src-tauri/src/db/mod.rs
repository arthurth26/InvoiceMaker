pub mod migrations;
pub mod models;
pub mod repository;

use std::{
	fs,
	path::{Path, PathBuf},
	time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{backup::Backup, Connection};
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub enum DatabaseError {
	AppDataDirectory(tauri::Error),
	FileSystem(std::io::Error),
	Sqlite(rusqlite::Error),
	SystemClock(std::time::SystemTimeError),
}

impl std::fmt::Display for DatabaseError {
	fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::AppDataDirectory(error) => write!(formatter, "app data directory error: {error}"),
			Self::FileSystem(error) => write!(formatter, "file system error: {error}"),
			Self::Sqlite(error) => write!(formatter, "SQLite error: {error}"),
			Self::SystemClock(error) => write!(formatter, "system clock error: {error}"),
		}
	}
}

impl std::error::Error for DatabaseError {}

impl From<rusqlite::Error> for DatabaseError {
	fn from(error: rusqlite::Error) -> Self {
		Self::Sqlite(error)
	}
}

pub fn open_and_migrate(app: &AppHandle) -> Result<Connection, DatabaseError> {
	let database_directory = app.path().app_local_data_dir().map_err(DatabaseError::AppDataDirectory)?;
	open_and_migrate_at(&database_directory)
}

fn open_and_migrate_at(database_directory: &Path) -> Result<Connection, DatabaseError> {
	fs::create_dir_all(database_directory).map_err(DatabaseError::FileSystem)?;
	let database_path = database_directory.join("invoicemaker.db");
	let mut connection = Connection::open(&database_path)?;

	if migrations::has_pending_migrations(&connection)? && database_path.exists() {
		create_migration_backup(&connection, database_directory)?;
	}

	migrations::migrate(&mut connection)?;
	Ok(connection)
}

fn create_migration_backup(connection: &Connection, database_directory: &Path) -> Result<PathBuf, DatabaseError> {
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(DatabaseError::SystemClock)?
		.as_millis();
	let backup_path = database_directory.join(format!("invoicemaker-before-migration-{timestamp}.db"));
	let mut backup_connection = Connection::open(&backup_path)?;
	let backup = Backup::new(connection, &mut backup_connection)?;
	backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;

	Ok(backup_path)
}

#[cfg(test)]
mod tests {
	use std::fs;

	use super::open_and_migrate_at;

	#[test]
	fn opens_and_migrates_the_app_database() {
		let directory = std::env::temp_dir().join(format!(
			"invoicemaker-db-test-{}",
			std::process::id()
		));
		let _ = fs::remove_dir_all(&directory);

		let connection = open_and_migrate_at(&directory).expect("open migrated database");
		let version: u32 = connection
			.pragma_query_value(None, "user_version", |row| row.get(0))
			.expect("read schema version");

		assert_eq!(version, 1);
		assert!(directory.join("invoicemaker.db").exists());

		drop(connection);
		fs::remove_dir_all(directory).expect("remove test database directory");
	}
}


