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

pub fn create_manual_backup(connection: &Connection, destination: &Path) -> Result<(), DatabaseError> {
	connection.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])?;
	Ok(())
}

pub fn restore_backup(source: &Path, connection: &mut Connection, database_directory: &Path) -> Result<(), DatabaseError> {
	create_backup(connection, database_directory, "invoicemaker-before-restore")?;
	let source_connection = Connection::open(source)?;
	let backup = Backup::new(&source_connection, connection)?;
	backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;
	Ok(())
}

pub fn create_replacement_backup(connection: &Connection, database_directory: &Path) -> Result<PathBuf, DatabaseError> {
	create_backup(connection, database_directory, "invoicemaker-before-replacement")
}

pub fn create_deletion_backup(connection: &Connection, database_directory: &Path) -> Result<PathBuf, DatabaseError> {
	create_backup(connection, database_directory, "invoicemaker-before-deletion")
}

pub fn store_proof(source: &Path, document_id: &str, database_directory: &Path) -> Result<String, DatabaseError> {
	let filename = source.file_name().ok_or_else(|| DatabaseError::FileSystem(std::io::Error::new(
		std::io::ErrorKind::InvalidInput,
		"proof file must have a filename",
	)))?;
	let relative_path = Path::new("invoices").join(document_id).join(filename);
	let destination = database_directory.join(&relative_path);
	if let Some(directory) = destination.parent() {
		fs::create_dir_all(directory).map_err(DatabaseError::FileSystem)?;
	}
	fs::copy(source, destination).map_err(DatabaseError::FileSystem)?;
	Ok(relative_path.to_string_lossy().into_owned())
}

pub fn open_proof(relative_path: &str, database_directory: &Path) -> Result<(), DatabaseError> {
	tauri_plugin_opener::open_path(database_directory.join(relative_path), Option::<String>::None)
		.map_err(|error| DatabaseError::FileSystem(std::io::Error::other(error.to_string())))
}

pub fn save_pdf(destination: &Path, contents: &[u8]) -> Result<(), DatabaseError> {
	if let Some(directory) = destination.parent() {
		fs::create_dir_all(directory).map_err(DatabaseError::FileSystem)?;
	}
	fs::write(destination, contents).map_err(DatabaseError::FileSystem)
}

fn open_and_migrate_at(database_directory: &Path) -> Result<Connection, DatabaseError> {
	fs::create_dir_all(database_directory).map_err(DatabaseError::FileSystem)?;
	let database_path = database_directory.join("invoicemaker.db");
	let database_already_exists = database_path.exists();
	let mut connection = Connection::open(&database_path)?;

	if database_already_exists && migrations::has_pending_migrations(&connection)? {
		create_migration_backup(&connection, database_directory)?;
	}

	migrations::migrate(&mut connection)?;
	Ok(connection)
}

fn create_migration_backup(connection: &Connection, database_directory: &Path) -> Result<PathBuf, DatabaseError> {
	create_backup(connection, database_directory, "invoicemaker-before-migration")
}

fn create_backup(connection: &Connection, database_directory: &Path, prefix: &str) -> Result<PathBuf, DatabaseError> {
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(DatabaseError::SystemClock)?
		.as_millis();
	let backup_path = database_directory.join(format!("{prefix}-{timestamp}.db"));
	let mut backup_connection = Connection::open(&backup_path)?;
	let backup = Backup::new(connection, &mut backup_connection)?;
	backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;

	Ok(backup_path)
}

#[cfg(test)]
mod tests {
	use std::fs;

	use super::{create_manual_backup, open_and_migrate_at, save_pdf};

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
		assert!(fs::read_dir(&directory)
			.expect("read test database directory")
			.all(|entry| !entry
				.expect("read test database entry")
				.file_name()
				.to_string_lossy()
				.starts_with("invoicemaker-before-migration-")));

		drop(connection);
		fs::remove_dir_all(directory).expect("remove test database directory");
	}

	#[test]
	fn creates_a_consistent_standalone_database_backup() {
		let directory = std::env::temp_dir().join(format!(
			"invoicemaker-backup-test-{}",
			std::process::id()
		));
		let _ = fs::remove_dir_all(&directory);
		fs::create_dir_all(&directory).expect("create test directory");
		let source_path = directory.join("source.db");
		let backup_path = directory.join("backup.db");
		let connection = rusqlite::Connection::open(&source_path).expect("open source database");
		connection
			.execute_batch("CREATE TABLE test_records (value TEXT); INSERT INTO test_records VALUES ('saved');")
			.expect("create source data");

		create_manual_backup(&connection, &backup_path).expect("create backup");
		drop(connection);

		let backup = rusqlite::Connection::open(backup_path).expect("open backup database");
		let value: String = backup
			.query_row("SELECT value FROM test_records", [], |row| row.get(0))
			.expect("read backup data");
		assert_eq!(value, "saved");

		drop(backup);
		fs::remove_dir_all(directory).expect("remove test database directory");
	}

	#[test]
	fn writes_pdf_contents_to_the_selected_destination() {
		let directory = std::env::temp_dir().join(format!("invoicemaker-pdf-test-{}", std::process::id()));
		let path = directory.join("output.pdf");
		let _ = fs::remove_dir_all(&directory);

		save_pdf(&path, b"%PDF-test").expect("write PDF");

		assert_eq!(fs::read(&path).expect("read PDF"), b"%PDF-test");
		fs::remove_dir_all(directory).expect("remove test PDF directory");
	}
}


