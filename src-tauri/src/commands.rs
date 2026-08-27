use tauri::State;

use crate::{
	db::{models::{Client, CompanyInfo, Document, StoredRecord}, repository::Repository},
	DatabaseState,
};

type CommandResult<T> = Result<T, String>;

#[tauri::command]
pub fn get_company(database: State<'_, DatabaseState>) -> CommandResult<Option<StoredRecord<CompanyInfo>>> {
	with_repository(&database, |repository| repository.get_company())
}

#[tauri::command]
pub fn save_company(
	record: StoredRecord<CompanyInfo>,
	database: State<'_, DatabaseState>,
) -> CommandResult<()> {
	with_repository(&database, |repository| repository.upsert_company(&record))
}

#[tauri::command]
pub fn list_clients(database: State<'_, DatabaseState>) -> CommandResult<Vec<StoredRecord<Client>>> {
	with_repository(&database, |repository| repository.list_clients())
}

#[tauri::command]
pub fn save_client(record: StoredRecord<Client>, database: State<'_, DatabaseState>) -> CommandResult<()> {
	with_repository(&database, |repository| repository.upsert_client(&record))
}

#[tauri::command]
pub fn list_documents(database: State<'_, DatabaseState>) -> CommandResult<Vec<StoredRecord<Document>>> {
	with_repository(&database, |repository| repository.list_documents())
}

#[tauri::command]
pub fn get_document(id: String, database: State<'_, DatabaseState>) -> CommandResult<Option<StoredRecord<Document>>> {
	with_repository(&database, |repository| repository.get_document(&id))
}

#[tauri::command]
pub fn create_document(record: StoredRecord<Document>, database: State<'_, DatabaseState>) -> CommandResult<()> {
	with_repository(&database, |repository| repository.create_document(&record))
}

#[tauri::command]
pub fn update_document(record: StoredRecord<Document>, database: State<'_, DatabaseState>) -> CommandResult<()> {
	with_repository(&database, |repository| repository.update_document(&record))
}

fn with_repository<T>(
	database: &State<'_, DatabaseState>,
	operation: impl FnOnce(&Repository<'_>) -> crate::db::repository::RepositoryResult<T>,
) -> CommandResult<T> {
	let connection = database.0.lock().map_err(|_| "database connection is unavailable".to_owned())?;
	operation(&Repository::new(&connection)).map_err(|error| error.to_string())
}