pub mod importer;
pub mod model;
pub mod repository;
use base64::Engine;
use importer::{Package, MAX_ZIP};
use model::*;
use repository::{tick_ms, Repository};
use std::{
    io::Read,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

struct Stage {
    token: String,
    package: Package,
    created: Instant,
}
struct Core {
    repo: Repository,
    stage: Option<Stage>,
}
type Shared = Arc<Mutex<Core>>;
fn locked(s: &Shared) -> AppResult<std::sync::MutexGuard<'_, Core>> {
    s.lock()
        .map_err(|_| "The database lock failed. Restart the application.".into())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Staged {
    token: String,
    manifest: Manifest,
    questions: Vec<Question>,
    solutions: Vec<Solution>,
    duplicate: Option<String>,
}

#[tauri::command]
async fn stage_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
) -> AppResult<Option<Staged>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The backend owns the picker and never accepts arbitrary filesystem paths over IPC.
        let file = app
            .dialog()
            .file()
            .add_filter("SPhO examination ZIP", &["zip"])
            .blocking_pick_file();
        let Some(file) = file else { return Ok(None) };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open ZIP: {e}"))?;
        if file.metadata().map_err(|e| e.to_string())?.len() > MAX_ZIP as u64 {
            return Err("ZIP exceeds 64 MiB".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_ZIP as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let package = importer::read_package(&bytes)?;
        let mut core = locked(&state)?;
        let duplicate = core.repo.import_status(&package)?;
        let token = uuid::Uuid::new_v4().to_string();
        let out = Staged {
            token: token.clone(),
            manifest: package.manifest.clone(),
            questions: package.questions.clone(),
            solutions: package.solutions.clone(),
            duplicate,
        };
        core.stage = Some(Stage {
            token,
            package,
            created: Instant::now(),
        });
        Ok(Some(out))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn commit_import(token: String, state: tauri::State<'_, Shared>) -> AppResult<String> {
    let mut c = locked(&state)?;
    let stage = c
        .stage
        .take()
        .ok_or("No staged package; select the ZIP again")?;
    if token != stage.token || stage.created.elapsed() > Duration::from_secs(600) {
        return Err("Import session expired; select the ZIP again".into());
    }
    // Called only after the trusted bundled renderer validates every Markdown/math block.
    c.repo.import(&stage.package)
}
#[tauri::command]
fn cancel_import(state: tauri::State<'_, Shared>) -> AppResult<()> {
    locked(&state)?.stage = None;
    Ok(())
}
#[tauri::command]
fn library(state: tauri::State<'_, Shared>) -> AppResult<Vec<LibraryExam>> {
    locked(&state)?.repo.library()
}
#[tauri::command]
fn active_attempt(state: tauri::State<'_, Shared>) -> AppResult<Option<Attempt>> {
    let mut c = locked(&state)?;
    c.repo.checkpoint(tick_ms())?;
    c.repo.active()
}
#[tauri::command]
fn load_exam(exam_id: String, state: tauri::State<'_, Shared>) -> AppResult<Exam> {
    locked(&state)?.repo.exam(&exam_id)
}
#[tauri::command]
fn load_attempt(attempt_id: String, state: tauri::State<'_, Shared>) -> AppResult<Attempt> {
    let mut c = locked(&state)?;
    c.repo.checkpoint(tick_ms())?;
    c.repo.attempt(&attempt_id)
}
#[tauri::command]
fn start_attempt(exam_id: String, state: tauri::State<'_, Shared>) -> AppResult<Attempt> {
    locked(&state)?.repo.start(&exam_id, tick_ms())
}
#[tauri::command]
fn change_attempt(
    attempt_id: String,
    change: Change,
    state: tauri::State<'_, Shared>,
) -> AppResult<Attempt> {
    locked(&state)?.repo.change(&attempt_id, change, tick_ms())
}
#[tauri::command]
fn submit_attempt(attempt_id: String, state: tauri::State<'_, Shared>) -> AppResult<Attempt> {
    locked(&state)?.repo.submit(&attempt_id, tick_ms())
}
#[tauri::command]
fn load_solutions(attempt_id: String, state: tauri::State<'_, Shared>) -> AppResult<Vec<Solution>> {
    locked(&state)?.repo.solutions(&attempt_id)
}
#[tauri::command]
fn load_asset(exam_id: String, path: String, state: tauri::State<'_, Shared>) -> AppResult<String> {
    let (mime, bytes) = locked(&state)?.repo.asset(&exam_id, &path)?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Optional trusted process-level override for isolated QA / portable local storage.
            // Never accepted from frontend IPC. Normal installations use the Windows local data directory.
            let dir = match std::env::var_os("SPHO_DATA_DIR") {
                Some(path) => {
                    let path = std::path::PathBuf::from(path);
                    if !path.is_absolute() {
                        return Err(std::io::Error::other(
                            "SPHO_DATA_DIR must be an absolute directory path",
                        )
                        .into());
                    }
                    path
                }
                None => app.path().app_local_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            let repo =
                Repository::open(&dir.join("spho.sqlite3")).map_err(std::io::Error::other)?;
            let shared: Shared = Arc::new(Mutex::new(Core { repo, stage: None }));
            app.manage(shared.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                match locked(&shared).and_then(|mut c| c.repo.checkpoint(tick_ms())) {
                    Ok(()) => {}
                    Err(e) => {
                        let _ = handle.emit("storage-error", e);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.state::<Shared>();
            let result = match event {
                tauri::WindowEvent::Focused(focused) => {
                    locked(&state).and_then(|mut c| c.repo.set_viewing(*focused, tick_ms()))
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Flush the latest foreground note edits before allowing native closure.
                    // The frontend acknowledges via finish_close; native timer checkpoints continue until then.
                    api.prevent_close();
                    window
                        .emit("close-requested", ())
                        .map_err(|e| e.to_string())
                }
                _ => Ok(()),
            };
            if let Err(e) = result {
                let _ = window.emit("storage-error", e);
            }
        })
        .invoke_handler(tauri::generate_handler![
            stage_import,
            commit_import,
            cancel_import,
            library,
            active_attempt,
            load_exam,
            load_attempt,
            start_attempt,
            change_attempt,
            submit_attempt,
            load_solutions,
            load_asset,
            finish_close
        ])
        .build(tauri::generate_context!())
        .expect("Cannot initialize SPhO Exam Simulator")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(s) = app.try_state::<Shared>() {
                    if let Ok(mut c) = s.lock() {
                        let _ = c.repo.checkpoint(tick_ms());
                    }
                }
            }
        });
}
#[tauri::command]
fn finish_close(app: tauri::AppHandle, state: tauri::State<'_, Shared>) -> AppResult<()> {
    locked(&state)?.repo.checkpoint(tick_ms())?;
    app.exit(0);
    Ok(())
}
