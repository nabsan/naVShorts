#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Ensure WebView2 can create its user data folder in restricted environments.
    let webview_data_dir = std::env::temp_dir().join("shorts-reels-maker-webview2");
    let _ = std::fs::create_dir_all(&webview_data_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_data_dir);

    shorts_reels_maker_lib::run();
}