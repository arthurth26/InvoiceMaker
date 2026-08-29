use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    db::{
        models::{Client, CompanyInfo, Document, StoredRecord},
        repository::Repository,
    },
    DatabaseState,
};

type CommandResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseLocations {
    pub database_directory: String,
    pub backup_directory: String,
}

#[tauri::command]
pub fn get_company(
    database: State<'_, DatabaseState>,
) -> CommandResult<Option<StoredRecord<CompanyInfo>>> {
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
pub fn list_clients(
    database: State<'_, DatabaseState>,
) -> CommandResult<Vec<StoredRecord<Client>>> {
    with_repository(&database, |repository| repository.list_clients())
}

#[tauri::command]
pub fn save_client(
    record: StoredRecord<Client>,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    save_client_with_replacement(record, false, database)
}

#[tauri::command]
pub fn replace_client(
    record: StoredRecord<Client>,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    save_client_with_replacement(record, true, database)
}

#[tauri::command]
pub fn list_documents(
    database: State<'_, DatabaseState>,
) -> CommandResult<Vec<StoredRecord<Document>>> {
    with_repository(&database, |repository| repository.list_documents())
}

#[tauri::command]
pub fn get_document(
    id: String,
    database: State<'_, DatabaseState>,
) -> CommandResult<Option<StoredRecord<Document>>> {
    with_repository(&database, |repository| repository.get_document(&id))
}

#[tauri::command]
pub fn create_document(
    record: StoredRecord<Document>,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    with_repository(&database, |repository| repository.create_document(&record))
}

#[tauri::command]
pub fn update_document(
    record: StoredRecord<Document>,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    with_repository(&database, |repository| repository.update_document(&record))
}

#[tauri::command]
pub fn store_proof(
    source: String,
    document_id: String,
    database: State<'_, DatabaseState>,
) -> CommandResult<String> {
    crate::db::store_proof(
        Path::new(&source),
        &document_id,
        &database.database_directory,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_proof(relative_path: String, database: State<'_, DatabaseState>) -> CommandResult<()> {
    crate::db::open_proof(&relative_path, &database.database_directory)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_database_locations(
    database: State<'_, DatabaseState>,
) -> CommandResult<DatabaseLocations> {
    let backup_directory = database
        .backup_directory
        .lock()
        .map_err(|_| "database backup location is unavailable".to_owned())?;
    Ok(DatabaseLocations {
        database_directory: database.database_directory.to_string_lossy().into_owned(),
        backup_directory: backup_directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn set_automatic_backup_directory(
    directory: String,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    let directory = Path::new(&directory);
    crate::db::set_backup_directory(&database.database_directory, directory)
        .map_err(|error| error.to_string())?;
    let mut backup_directory = database
        .backup_directory
        .lock()
        .map_err(|_| "database backup location is unavailable".to_owned())?;
    *backup_directory = directory.to_path_buf();
    Ok(())
}

#[tauri::command]
pub fn delete_document(id: String, database: State<'_, DatabaseState>) -> CommandResult<()> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "database connection is unavailable".to_owned())?;
    let backup_directory = database
        .backup_directory
        .lock()
        .map_err(|_| "database backup location is unavailable".to_owned())?;
    crate::db::create_deletion_backup(&connection, &backup_directory)
        .map_err(|error| error.to_string())?;
    Repository::new(&connection)
        .delete_document(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_manual_backup(
    destination: String,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "database connection is unavailable".to_owned())?;
    crate::db::create_manual_backup(&connection, Path::new(&destination))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_backup(
    source: String,
    app: AppHandle,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    {
        let mut connection = database
            .connection
            .lock()
            .map_err(|_| "database connection is unavailable".to_owned())?;
        let backup_directory = database
            .backup_directory
            .lock()
            .map_err(|_| "database backup location is unavailable".to_owned())?;
        crate::db::restore_backup(Path::new(&source), &mut connection, &backup_directory)
            .map_err(|error| error.to_string())?;
    }
    app.restart();
}

#[tauri::command]
pub fn save_pdf(destination: String, contents: Vec<u8>) -> CommandResult<()> {
    crate::db::save_pdf(Path::new(&destination), &contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_csv(destination: String, contents: String) -> CommandResult<()> {
    crate::db::save_pdf(Path::new(&destination), contents.as_bytes())
        .map_err(|error| error.to_string())
}

fn with_repository<T>(
    database: &State<'_, DatabaseState>,
    operation: impl FnOnce(&Repository<'_>) -> crate::db::repository::RepositoryResult<T>,
) -> CommandResult<T> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "database connection is unavailable".to_owned())?;
    operation(&Repository::new(&connection)).map_err(|error| error.to_string())
}

fn save_client_with_replacement(
    record: StoredRecord<Client>,
    replace_existing: bool,
    database: State<'_, DatabaseState>,
) -> CommandResult<()> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "database connection is unavailable".to_owned())?;
    let repository = Repository::new(&connection);
    if repository
        .has_cross_kind_id_collision(&record.id)
        .map_err(|error| error.to_string())?
    {
        if !replace_existing {
            return Err(
                "record ID belongs to another record type; confirm replacement to continue"
                    .to_owned(),
            );
        }
        let backup_directory = database
            .backup_directory
            .lock()
            .map_err(|_| "database backup location is unavailable".to_owned())?;
        crate::db::create_replacement_backup(&connection, &backup_directory)
            .map_err(|error| error.to_string())?;
    }
    repository
        .upsert_client(&record, replace_existing)
        .map_err(|error| error.to_string())
}
