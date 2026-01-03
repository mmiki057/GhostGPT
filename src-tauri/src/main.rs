// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Get main window
            let window = app.get_webview_window("main")
                .expect("Failed to get main window");

            // Platform-specific window setup for macOS overlay
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                use cocoa::base::id;
                use objc::{msg_send, sel, sel_impl};

                unsafe {
                    let ns_window = window.ns_window().unwrap() as id;

                    // Set window level to floating (above normal windows)
                    ns_window.setLevel_(3); // NSFloatingWindowLevel

                    // Configure collection behavior
                    let collection_behavior = NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle;

                    ns_window.setCollectionBehavior_(collection_behavior);

                    // Enable window movement
                    let _: () = msg_send![ns_window, setMovable: true];
                    let _: () = msg_send![ns_window, setMovableByWindowBackground: true];

                    // Make window invisible in screen recordings and screenshots
                    // NSWindowSharingNone = 0
                    let sharing_type: i64 = 0;
                    let _: () = msg_send![ns_window, setSharingType: sharing_type];
                }
            }

            // Register global hotkey to show/hide window
            let hotkey_options = vec![
                "CommandOrControl+Shift+Space",
                "CommandOrControl+Option+G",
            ];

            let mut registered = false;
            for hotkey_str in hotkey_options {
                if let Ok(shortcut) = hotkey_str.parse::<Shortcut>() {
                    if app.global_shortcut().register(shortcut).is_ok() {
                        app.global_shortcut().on_shortcut(shortcut, {
                            let window = window.clone();
                            move |_app, _shortcut, _event| {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }).ok();

                        println!("✓ Registered global hotkey: {}", hotkey_str);
                        registered = true;
                        break;
                    }
                }
            }

            if !registered {
                eprintln!("Warning: Could not register any global hotkey");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running Tauri application");
}
