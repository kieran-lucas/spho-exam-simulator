//! Test-only JSON-lines bridge to the SAME importer/repository used by the desktop.
//! Never enabled or bundled in production. No network listener.
use base64::Engine;
use serde_json::{json, Value};
use spho_lib::{
    importer,
    model::*,
    repository::{tick_ms, Repository},
};
use std::io::{self, BufRead, Write};
fn main() {
    let path = std::env::args().nth(1).expect("database path");
    let mut repo = Repository::open(std::path::Path::new(&path)).unwrap();
    let mut staged = None;
    let mut offset = 0u64;
    for line in io::stdin().lock().lines() {
        let value: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let cmd = value["cmd"].as_str().unwrap();
        let args = &value["args"];
        let now = tick_ms() + offset;
        let result: AppResult<Value> = (|| {
            repo.checkpoint(now)?;
            let text = |name: &str| args[name].as_str().unwrap_or("").to_string();
            match cmd {
                "library" => Ok(json!(repo.library()?)),
                "active_attempt" => Ok(json!(repo.active()?)),
                "load_exam" => Ok(json!(repo.exam(&text("examId"))?)),
                "load_attempt" => Ok(json!(repo.attempt(&text("attemptId"))?)),
                "start_attempt" => Ok(json!(repo.start(&text("examId"), now)?)),
                "change_attempt" => Ok(json!(repo.change(
                    &text("attemptId"),
                    serde_json::from_value(args["change"].clone()).map_err(|e| e.to_string())?,
                    now
                )?)),
                "submit_attempt" => Ok(json!(repo.submit(&text("attemptId"), now)?)),
                "load_solutions" => Ok(json!(repo.solutions(&text("attemptId"))?)),
                "load_asset" => {
                    let (m, b) = repo.asset(&text("examId"), &text("path"))?;
                    Ok(json!(format!(
                        "data:{m};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(b)
                    )))
                }
                "stage_import" => {
                    let bytes = std::fs::read(text("fixture")).map_err(|e| e.to_string())?;
                    let p = importer::read_package(&bytes)?;
                    let duplicate = repo.import_status(&p)?;
                    let response = json!({"token":"qa-token","manifest":p.manifest,"questions":p.questions,"solutions":p.solutions,"duplicate":duplicate});
                    staged = Some(p);
                    Ok(response)
                }
                "commit_import" => Ok(json!(repo.import(&staged.take().ok_or("No stage")?)?)),
                "cancel_import" => {
                    staged = None;
                    Ok(Value::Null)
                }
                "finish_close" => {
                    repo.checkpoint(now)?;
                    repo.session = None;
                    Ok(Value::Null)
                }
                "qa_advance" => {
                    offset += args["ms"].as_u64().unwrap();
                    repo.checkpoint(tick_ms() + offset)?;
                    Ok(Value::Null)
                }
                "qa_focus" => {
                    repo.set_viewing(args["focused"].as_bool().unwrap(), now)?;
                    Ok(Value::Null)
                }
                _ => Err(format!("Unknown command {cmd}")),
            }
        })();
        let response = match result {
            Ok(v) => json!({"ok":v}),
            Err(e) => json!({"error":e}),
        };
        println!("{response}");
        io::stdout().flush().unwrap();
    }
}
