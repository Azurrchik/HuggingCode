#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use rfd::FileDialog;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

struct BridgeState {
    stdin: Mutex<ChildStdin>,
    _child: Mutex<Child>,
    pending: Pending,
    next_id: Mutex<u64>,
}

impl BridgeState {
    fn start(app: AppHandle) -> Result<Self, String> {
        let development_root = std::env::var("HUGGINGCODE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let development_bridge = development_root.join("desktop").join("tauri-bridge.js");
        let resource_root = app.path().resource_dir().ok();
        let bundled_bridge = resource_root
            .as_ref()
            .map(|root| root.join("desktop").join("tauri-bridge.js"));
        let (root, bridge) = if development_bridge.exists() {
            (development_root, development_bridge)
        } else if let Some(bridge) = bundled_bridge.filter(|path| path.exists()) {
            (resource_root.unwrap_or_else(|| PathBuf::from(".")), bridge)
        } else {
            return Err(
                "Не найден локальный HuggingCode bridge в исходниках или bundled resources."
                    .to_string(),
            );
        };
        let bundled_node = root.join("runtime").join(if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        });
        let node = std::env::var("HUGGINGCODE_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                if bundled_node.exists() {
                    bundled_node
                } else {
                    PathBuf::from("node")
                }
            });
        let mut bridge_command = Command::new(node);
        bridge_command
            .arg(bridge)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            bridge_command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = bridge_command.spawn().map_err(|error| {
            format!("Не удалось запустить локальный HuggingCode bridge: {error}")
        })?;
        let stdin = child.stdin.take().ok_or("Bridge stdin недоступен")?;
        let stdout = child.stdout.take().ok_or("Bridge stdout недоступен")?;
        let stderr = child.stderr.take().ok_or("Bridge stderr недоступен")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = pending.clone();
        let stderr_app = app.clone();

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = stderr_app.emit(
                    "agent:event",
                    json!({ "type": "error", "content": format!("Desktop bridge: {line}") }),
                );
            }
        });

        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if message.get("type").and_then(Value::as_str) == Some("event") {
                    let _ = app.emit(
                        "agent:event",
                        message.get("event").cloned().unwrap_or(Value::Null),
                    );
                    continue;
                }
                if message.get("type").and_then(Value::as_str) == Some("response") {
                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        if let Some(sender) = reader_pending
                            .lock()
                            .ok()
                            .and_then(|mut entries| entries.remove(&id))
                        {
                            let _ = sender.send(message);
                        }
                    }
                }
            }
            let _ = app.emit(
                "agent:event",
                json!({ "type": "error", "content": "Локальный desktop bridge завершил работу." }),
            );
        });

        Ok(Self {
            stdin: Mutex::new(stdin),
            _child: Mutex::new(child),
            pending,
            next_id: Mutex::new(1),
        })
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = {
            let mut next = self
                .next_id
                .lock()
                .map_err(|_| "Desktop bridge lock error")?;
            let value = *next;
            *next += 1;
            value
        };
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "Desktop bridge pending lock error")?
            .insert(id, sender);
        let request = json!({ "id": id, "method": method, "params": params });
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "Desktop bridge stdin lock error")?;
        writeln!(stdin, "{}", request)
            .map_err(|error| format!("Не удалось отправить команду bridge: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Не удалось завершить команду bridge: {error}"))?;
        let response = receiver
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| "Превышено время ожидания ответа desktop bridge")?;
        if response.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(response.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Desktop bridge error")
                .to_string())
        }
    }
}

#[tauri::command]
fn bridge_call(
    state: State<'_, BridgeState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    state.call(&method, params)
}

#[tauri::command]
fn choose_workspace() -> Option<String> {
    FileDialog::new()
        .pick_folder()
        .map(|folder| folder.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let state = BridgeState::start(app.handle().clone()).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge_call, choose_workspace])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска HuggingCode Desktop");
}
