// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod db;
mod commands;

use std::sync::Mutex;

use tauri::Manager;

pub struct DatabaseState(pub Mutex<rusqlite::Connection>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let connection = db::open_and_migrate(app.handle())?;
            app.manage(DatabaseState(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::get_company,
            commands::save_company,
            commands::list_clients,
            commands::save_client,
            commands::list_documents,
            commands::get_document,
            commands::create_document,
            commands::update_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
